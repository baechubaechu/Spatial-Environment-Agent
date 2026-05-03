/**
 * Hongik_wifi 등 WPA2-Enterprise / EAP-TTLS 용 (+ HTTP POST /light/scene)
 *
 * 라이브러리: Adafruit NeoPixel 만 (ArduinoJson 불필요 — JSON은 아래 문자열 파서로 처리)
 * 보드 패키지: esp32 by Espressif 최근 버전 (WPA2 Enterprise)
 *
 * EAP_* 는 본인 계정으로 채우세요. 이 파일을 Git 에 올릴 때 비밀번호가 노출되지 않게 주의하세요.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_NeoPixel.h>

// --- 에이전트와 동일한 형태의 평면 JSON만 파싱 ---
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
  int out = neg ? -(int)v : (int)v;
  return out;
}

static const char *WIFI_SSID = "Hongik_wifi";

#define EAP_IDENTITY "YOUR_OUTER_ID_OR_ANONYMOUS"
#define EAP_USERNAME "YOUR_USERNAME"
#define EAP_PASSWORD "YOUR_PASSWORD"

#ifndef TTLS_PHASE2_METHOD
#define TTLS_PHASE2_METHOD 0
#endif

#define LED_PIN 5
#define NUM_LEDS 60

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);
WebServer server(80);

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

bool connectEnterprise() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  const char *identity = EAP_IDENTITY;
  if (strlen(identity) == 0) {
    identity = EAP_USERNAME;
  }

  Serial.printf("Connecting WPA2_ENT TTLS ssid=%s phase2=%d\n", WIFI_SSID, TTLS_PHASE2_METHOD);
  Serial.printf("identity(len=%u) username(len=%u)\n", (unsigned)strlen(identity),
                (unsigned)strlen(EAP_USERNAME));

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
    Serial.println("===== WiFi failed =====");
    Serial.printf(
        "WiFi.status()=%d  (ESP32 기준: 3=연결됨, 1=SSID 없음, 4=연결실패, 5=연결중 끊김/Lost, 6=Disconnected)\n",
        (int)WiFi.status());
    Serial.println("체크 순서:");
    Serial.println("  1) 노트북이 같은 SSID(Hongik_wifi)에 붙는지, 비번·아이디가 스케치와 동일한지");
    Serial.println("  2) 스케치 위쪽 TTLS_PHASE2_METHOD: 0(MSCHAPv2) 안 되면 2(PAP) 로 바꿔 업로드");
    Serial.println("  3) EAP_IDENTITY 를 학번과 동일·또는 \"anonymous\" 로 바꿔 보기");
    Serial.println("  4) 학교망이 기기별 MAC 허용이면 포털에서 ESP MAC 등록 필요할 수 있음");
    Serial.println("  5) 여전히 안 되면 핫스팟 + esp32_http_light 스케치로 LED 경로만 먼저 확인");
    return false;
  }
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  return true;
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

  server.on("/light/scene", HTTP_POST, handleLightScene);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();
  Serial.println("HTTP /light/scene ready");
}

void loop() {
  server.handleClient();
}
