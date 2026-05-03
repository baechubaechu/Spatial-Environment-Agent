/**
 * Exhibition Agent 연동용 — WiFi + HTTP POST /light/scene
 *
 * 스케치 매니저에서 라이브러리 설치: "Adafruit NeoPixel" 만 (ArduinoJson 불필요)
 *
 * WPA2 **개인용**(집·핫스팟 PSK) 전용. 학교 **Hongik_wifi / WPA2-Enterprise** 는 esp32_http_light_ent.ino 사용.
 *
 * 1) WIFI_SSID / WIFI_PASSWORD 수정
 * 2) 업로드 후 시리얼 모니터(115200)에 표시되는 IP 확인
 * 3) PC에서 exhibition-agent 환경 변수:
 *    EXHIBITION_LIGHT_HTTP_URL=http://(그 IP)
 *    그다음 FastAPI(uvicorn) 재시작
 */

#include <WiFi.h>
#include <WebServer.h>
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

#define WIFI_SSID "666"
#define WIFI_PASSWORD "135792468"

#define LED_PIN 5
#define NUM_LEDS 60

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

WebServer server(80);

int segmentStart[12] = {0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55};
int segmentEnd[12] = {4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59};

/** scenes.yaml 의 scene_id → 구간 0~11 (원하면 테이블만 수정) */
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

/** zoneA / zoneB 는 스트립 전반의 절반만 채움(단면 구역 연출). all 이면 기존 세그먼트 패턴. */
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

void handleHealth() {
  server.send(200, "text/plain", "ok");
}

void handleLightScene() {
  if (server.method() != HTTP_POST) {
    server.send(405, "text/plain", "Method Not Allowed");
    return;
  }

  String body = server.hasArg("plain") ? server.arg("plain") : "";
  if (body.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"empty body\"}");
    return;
  }

  String sceneId = jsonGetString(body, "scene_id");
  if (sceneId.length() == 0) {
    server.send(400, "application/json", "{\"error\":\"missing scene_id\"}");
    return;
  }

  int bri = jsonGetInt(body, "brightness", 30);
  bri = constrain(bri, 0, 100);

  if (bri <= 0) {
    strip.setBrightness(0);
    allOff();
    server.send(200, "application/json", "{\"ok\":true}");
    return;
  }

  String zone = jsonGetString(body, "zone");
  if (zone.length() == 0) {
    zone = "all";
  }

  applyZoneScene(sceneId, zone, bri);

  server.send(200, "application/json", "{\"ok\":true}");
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.setBrightness(30);
  allOff();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/light/scene", HTTP_POST, handleLightScene);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();
  Serial.println("HTTP /light/scene ready");
}

void loop() {
  server.handleClient();
}
