#include <Adafruit_NeoPixel.h>

#define LED_PIN 5
#define NUM_LEDS 60

Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// 60개 LED를 12구간, 한 구간당 5개로 나눔
int segmentStart[12] = {0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55};
int segmentEnd[12]   = {4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59};

void setup() {
  Serial.begin(115200);

  strip.begin();
  strip.setBrightness(30);
  strip.clear();
  strip.show();

  Serial.println("Ready.");
  Serial.println("Type 1~12 to turn on M1~M12.");
  Serial.println("Type 0 to turn off all LEDs.");
  Serial.println("Type 99 to turn on all LEDs.");
}

void loop() {
  if (Serial.available() > 0) {
    int input = Serial.parseInt();

    // 줄바꿈 문자 정리
    while (Serial.available() > 0) {
      Serial.read();
    }

    if (input >= 1 && input <= 12) {
      showSegment(input - 1);
      Serial.print("M");
      Serial.print(input);
      Serial.println(" ON");
    } 
    else if (input == 0) {
      strip.clear();
      strip.show();
      Serial.println("All OFF");
    } 
    else if (input == 99) {
      showAll(255, 255, 255);
      Serial.println("All ON");
    } 
    else {
      Serial.println("Invalid input. Type 1~12, 0, or 99.");
    }
  }
}

void showSegment(int segmentIndex) {
  strip.clear();

  int start = segmentStart[segmentIndex];
  int end = segmentEnd[segmentIndex];

  uint32_t color = getSegmentColor(segmentIndex);

  for (int i = start; i <= end; i++) {
    strip.setPixelColor(i, color);
  }

  strip.show();
}

uint32_t getSegmentColor(int i) {
  switch (i) {
    case 0: return strip.Color(255, 40, 20);    // M1
    case 1: return strip.Color(255, 120, 0);    // M2
    case 2: return strip.Color(255, 220, 0);    // M3
    case 3: return strip.Color(80, 255, 0);     // M4
    case 4: return strip.Color(0, 255, 80);     // M5
    case 5: return strip.Color(0, 255, 220);    // M6
    case 6: return strip.Color(0, 120, 255);    // M7
    case 7: return strip.Color(0, 40, 255);     // M8
    case 8: return strip.Color(120, 0, 255);    // M9
    case 9: return strip.Color(220, 0, 255);    // M10
    case 10: return strip.Color(255, 0, 150);   // M11
    case 11: return strip.Color(255, 0, 60);    // M12
    default: return strip.Color(255, 255, 255);
  }
}

void showAll(int r, int g, int b) {
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}