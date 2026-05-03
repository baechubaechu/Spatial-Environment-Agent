/**
 * HTTPS 폴링 조명 — WPA2-Enterprise (Hongik_wifi 등). VPS pull 모드 전용.
 *
 * 동작은 esp32_https_light_pull.ino 와 동일. WiFi 만 Enterprise 로 연결.
 * EAP_* 값은 본인 계정으로. Git 에 비밀번호 커밋 금지.
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

static const char *WIFI_SSID = "Hongik_wifi";

#define EAP_IDENTITY "YOUR_OUTER_ID_OR_ANONYMOUS"
#define EAP_USERNAME "YOUR_USERNAME"
#define EAP_PASSWORD "YOUR_PASSWORD"

#ifndef TTLS_PHASE2_METHOD
#define TTLS_PHASE2_METHOD 0
#endif

#define AGENT_BASE "https://your-vps-domain.com"
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

bool connectEnterprise() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  const char *identity = EAP_IDENTITY;
  if (strlen(identity) == 0) {
    identity = EAP_USERNAME;
  }

  WiFi.begin(WIFI_SSID, WPA2_AUTH_TTLS, identity, EAP_USERNAME, EAP_PASSWORD, nullptr, nullptr, nullptr,
             TTLS_PHASE2_METHOD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 180) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi enterprise failed");
    return false;
  }
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  return true;
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
  } else if (code < 0) {
    Serial.printf("HTTP error: %s\n", https.errorToString(code).c_str());
  } else {
    Serial.printf("HTTP status %d\n", code);
  }
  https.end();
  delete client;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  strip.begin();
  strip.setBrightness(30);
  allOff();

  if (!connectEnterprise()) {
    return;
  }
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
