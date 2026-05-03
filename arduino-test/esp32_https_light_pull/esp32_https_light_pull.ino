/**
 * Exhibition Agent — VPS / NAT 용 HTTPS 폴링 (미니 PC 불필요)
 *
 * FastAPI 쪽: EXHIBITION_LIGHT_MODE=pull + EXHIBITION_DEVICE_TOKEN 설정 후 배포.
 * 이 스케치의 AGENT_BASE / DEVICE_TOKEN 을 동일 정책으로 맞춤.
 *
 * 동작: 주기적으로 GET {AGENT_BASE}/device/light/next?since=N
 *       Authorization: Bearer {DEVICE_TOKEN}
 *       200 + JSON 이면 NeoPixel 적용, seq 갱신 / 204 면 유지
 *
 * 운영 TLS: 기본 setInsecure() — 상용은 Let's Encrypt 루트 인증서 번들로 교체 권장.
 *
 * 라이브러리: Adafruit NeoPixel (ArduinoJson 불필요)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_NeoPixel.h>

static String jsonGetString(const String &json, const char *key) {
  String pat = String("\"") + key + "\":\"";
  int i = json.indexOf(pat);
  if (i < 0) return "";
  i += pat.length();
  int j = json.indexOf('"', i);
  if (j < 0) return "";
  return json.substring(i, j);
}

static int jsonGetInt(const String &json, const char *key, int defaultVal) {
  String pat = String("\"") + key + "\":";
  int i = json.indexOf(pat);
  if (i < 0) return defaultVal;
  i += pat.length();
  while (i < (int)json.length() && (json.charAt(i) == ' ' || json.charAt(i) == '\t')) i++;
  long v = 0;
  bool neg = false;
  if (i < (int)json.length() && json.charAt(i) == '-') {
    neg = true;
    i++;
  }
  bool any = false;
  while (i < (int)json.length() && json.charAt(i) >= '0' && json.charAt(i) <= '9') {
    any = true;
    v = v * 10 + (json.charAt(i) - '0');
    i++;
  }
  if (!any) return defaultVal;
  return neg ? -(int)v : (int)v;
}

#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

/** 예: https://agent.example.com (끝에 슬래시 없음) — Nginx 가 /device/ 를 uvicorn 으로 넘김 */
#define AGENT_BASE "https://your-vps-domain.com"
/** 서버 .env 의 EXHIBITION_DEVICE_TOKEN 과 동일 */
#define DEVICE_TOKEN "change-me-long-random-secret"

#define POLL_MS 400

#define LED_PIN 5
#define NUM_LEDS 60

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

int segmentStart[12] = {0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55};
int segmentEnd[12] = {4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59};

int segmentFromSceneId(const String &id) {
  if (id == "calm_gallery") return 0;
  if (id == "dense_flux") return 1;
  if (id == "critical_focus") return 2;
  if (id == "night_reflect") return 3;
  if (id == "safe_neutral") return 4;
  if (id == "floor_pin_1") return 6;
  if (id == "floor_pin_2") return 7;
  if (id == "floor_pin_3") return 8;
  if (id == "floor_pin_4") return 9;
  if (id == "floor_pin_5") return 10;
  if (id == "floor_pin_6") return 11;
  return 0;
}

uint32_t colorForSegment(int segmentIndex) {
  segmentIndex = constrain(segmentIndex, 0, 11);
  return strip.Color(80 + segmentIndex * 15, 200 - segmentIndex * 10, 40 + segmentIndex * 5);
}

void showSegment(int segmentIndex) {
  segmentIndex = constrain(segmentIndex, 0, 11);
  strip.clear();
  int start = segmentStart[segmentIndex];
  int end = segmentEnd[segmentIndex];
  uint32_t color = colorForSegment(segmentIndex);
  for (int i = start; i <= end; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

void applyZoneScene(const String &sceneId, const String &zone, int bri) {
  strip.setBrightness(bri);
  int seg = segmentFromSceneId(sceneId);
  uint32_t color = colorForSegment(seg);

  if (zone == "zoneA" || zone == "zoneB") {
    strip.clear();
    int half = NUM_LEDS / 2;
    int startLed = (zone == "zoneB") ? half : 0;
    int endLed = (zone == "zoneB") ? (NUM_LEDS - 1) : (half - 1);
    for (int i = startLed; i <= endLed; i++) {
      strip.setPixelColor(i, color);
    }
    strip.show();
    return;
  }

  showSegment(seg);
}

void allOff() {
  strip.clear();
  strip.show();
}

void applySceneJson(const String &body) {
  String sceneId = jsonGetString(body, "scene_id");
  if (sceneId.length() == 0) {
    return;
  }
  int bri = jsonGetInt(body, "brightness", 30);
  bri = constrain(bri, 0, 100);
  if (bri <= 0) {
    strip.setBrightness(0);
    allOff();
    return;
  }
  String zone = jsonGetString(body, "zone");
  if (zone.length() == 0) {
    zone = "all";
  }
  applyZoneScene(sceneId, zone, bri);
}

unsigned long lastPollMs = 0;
long lastSeq = 0;

void pollAgentOnce() {
  WiFiClientSecure *client = new WiFiClientSecure;
  client->setInsecure();
  HTTPClient https;
  String url = String(AGENT_BASE) + "/device/light/next?since=" + String(lastSeq);
  if (!https.begin(*client, url)) {
    Serial.println("https.begin failed");
    delete client;
    return;
  }
  https.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  https.setTimeout(12000);
  int code = https.GET();
  if (code == 200) {
    String payload = https.getString();
    long seq = jsonGetInt(payload, "seq", -1);
    applySceneJson(payload);
    if (seq >= 0) {
      lastSeq = seq;
    }
    Serial.println("applied seq=" + String(seq));
  } else if (code == 204) {
    /* no new command */
  } else if (code < 0) {
    Serial.printf("HTTP error: %s\n", https.errorToString(code).c_str());
  } else {
    Serial.printf("HTTP status %d\n", code);
    String err = https.getString();
    if (err.length() > 0 && err.length() < 256) {
      Serial.println(err);
    }
  }
  https.end();
  delete client;
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.setBrightness(30);
  allOff();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  Serial.println("HTTPS poll mode — /device/light/next");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    return;
  }
  unsigned long now = millis();
  if (now - lastPollMs < POLL_MS) {
    delay(10);
    return;
  }
  lastPollMs = now;
  pollAgentOnce();
}
