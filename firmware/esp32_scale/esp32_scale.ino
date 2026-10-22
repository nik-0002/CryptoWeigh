/*
  Proof of Fair Weight - ESP32 firmware
  Reads weight (HX711), hashes it on the ATECC608A, sends it over HTTPS to
  your website on Vercel, asks the ESP32-CAM board to take a photo of every
  reading, and sounds the alarm + reports a tamper event.

  Libraries to install (Arduino IDE > Library Manager):
    - HX711 (by Bogdan Necula)
    - Adafruit GFX Library
    - Adafruit SH110X
    - ArduinoECCX08
  (WiFi and HTTPClient come built in with the ESP32 board package.)
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <HX711.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <ArduinoECCX08.h>

// ================== EDIT THESE 6 THINGS ==================
const char* WIFI_SSID   = "YOUR_WIFI_NAME";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL  = "https://YOUR-APP.vercel.app/api/readings";   // your Vercel address + /api/readings
const char* API_KEY     = "PASTE_YOUR_DEVICE_API_KEY";                  // same as DEVICE_API_KEY on Vercel
const char* CAM_IP      = "192.168.1.50";    // printed by the ESP32-CAM in its Serial Monitor
const bool  USE_CAMERA  = true;              // false = scale works without the camera board
// =========================================================

// --- PIN DEFINITIONS ---
const int HALL_PIN        = 27;
const int LOADCELL_DT_PIN = 18;
const int LOADCELL_SCK_PIN = 19;
const int BUZZER_PIN      = 25;

// --- SETTINGS FOR "STABLE WEIGHT" ---
const int   STABLE_COUNT = 5;       // number of readings that must agree
const float STABLE_BAND  = 0.02;    // ...within +/- this many kg
const float MIN_WEIGHT   = 0.05;    // below this = scale is empty
const float CHANGE_MIN   = 0.05;    // only send again if weight changed this much
const unsigned long RETRY_MS = 3000;

// --- COMPONENTS ---
HX711 scale;
Adafruit_SH1106G display = Adafruit_SH1106G(128, 64, &Wire, -1);
float calibration_factor = 2280.0;

volatile bool isLocked = false;
String chipSerialNumber = "";

float history[STABLE_COUNT];
int   histIdx = 0, histFilled = 0;
float lastWeight = 0.0;
float lastSentWeight = 0.0;
unsigned long lastAttempt = 0;
String statusText = "Starting...";

// --- SECURITY INTERRUPT ---
void IRAM_ATTR triggerLockdown() {
  isLocked = true;
}

// ---------- HELPERS ----------
String sha256Hex(const String& text) {
  byte result[32];
  ECCX08.beginSHA256();
  ECCX08.endSHA256((const byte*)text.c_str(), text.length(), result);
  String hex = "";
  for (int i = 0; i < 32; i++) {
    if (result[i] < 16) hex += "0";          // keep leading zero
    hex += String(result[i], HEX);
  }
  hex.toUpperCase();
  return hex;                                  // 64 characters
}

bool connectWiFi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

// Sends one reading. Returns the new reading id (>0) on success, 0 if saved but the id
// could not be read, or -1 on failure.
long sendReading(const String& weightStr, const String& hash, bool tamper) {
  if (!connectWiFi(8000)) {
    Serial.println("WiFi not connected");
    return -1;
  }
  String json = "{\"device_id\":\"" + chipSerialNumber +
                "\",\"weight_kg\":" + weightStr +
                ",\"data_hash\":\"" + hash +
                "\",\"tamper_status\":" + (tamper ? "true" : "false") + "}";

  WiFiClientSecure client;
  client.setInsecure();   // prototype: encrypts the data but does not check the server certificate
  HTTPClient http;
  http.begin(client, SERVER_URL);
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int code = http.POST(json);
  Serial.printf("POST %s -> %d\n", json.c_str(), code);
  String response = http.getString();
  http.end();
  if (code != 200) return -1;
  int pos = response.indexOf("\"id\":");
  return pos >= 0 ? response.substring(pos + 5).toInt() : 0;
}

// Tells the ESP32-CAM board to take a photo for this reading.
bool triggerCamera(long readingId) {
  if (!USE_CAMERA || readingId <= 0) return false;
  HTTPClient http;
  String url = "http://" + String(CAM_IP) + "/snap?id=" + String(readingId);
  http.begin(url);
  http.setTimeout(3000);
  http.addHeader("X-API-Key", API_KEY);
  int code = http.GET();
  http.end();
  Serial.printf("Camera trigger for reading %ld -> %d\n", readingId, code);
  return code == 202;
}

void addHistory(float w) {
  history[histIdx] = w;
  histIdx = (histIdx + 1) % STABLE_COUNT;
  if (histFilled < STABLE_COUNT) histFilled++;
}

bool isStable() {
  if (histFilled < STABLE_COUNT) return false;
  float mn = history[0], mx = history[0];
  for (int i = 1; i < STABLE_COUNT; i++) {
    if (history[i] < mn) mn = history[i];
    if (history[i] > mx) mx = history[i];
  }
  return (mx - mn) <= STABLE_BAND;
}

void drawMain(float weight, const String& hash) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("Weight:");
  display.setTextSize(3);
  display.setCursor(0, 15);
  display.print(weight, 2);
  display.setTextSize(1);
  display.setCursor(100, 30);
  display.print("kg");
  display.drawLine(0, 45, 128, 45, SH110X_WHITE);
  display.setCursor(0, 48);
  display.print(statusText);
  display.setCursor(0, 56);
  display.print("ID:");
  display.print(hash.substring(0, 8));
  display.display();
}

void drawLocked(const String& line) {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(10, 8);
  display.print("SYSTEM");
  display.setCursor(10, 28);
  display.print("LOCKED!");
  display.setTextSize(1);
  display.setCursor(0, 54);
  display.print(line);
  display.display();
}

// Called once when the Hall sensor trips. Never returns (press RESET to restart).
void handleLockdown() {
  digitalWrite(BUZZER_PIN, HIGH);                 // alarm starts immediately
  drawLocked("Reporting breach...");

  String wStr = String(lastWeight, 2);
  String hash = sha256Hex(wStr + "kg");
  bool sent = false;
  long readingId = -1;
  bool camDone = false;
  int camTries = 0;
  unsigned long lastCam = 0;
  unsigned long lastTry = 0;
  bool firstTry = true;
  bool buzzerOn = true;
  unsigned long lastToggle = millis();

  while (true) {
    unsigned long now = millis();
    if (!sent && (firstTry || now - lastTry > 5000)) {
      firstTry = false;
      readingId = sendReading(wStr, hash, true);
      sent = readingId >= 0;
      lastTry = millis();
      drawLocked(sent ? "Breach reported" : "Report failed-retry");
    }
    if (sent && USE_CAMERA && !camDone && camTries < 5 && (camTries == 0 || millis() - lastCam > 5000)) {
      camDone = triggerCamera(readingId);       // photo evidence of the breach
      camTries++;
      lastCam = millis();
      if (camDone) drawLocked("Breach + photo sent");
    }
    if (millis() - lastToggle >= 200) {            // pulsing alarm
      buzzerOn = !buzzerOn;
      digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
      lastToggle = millis();
    }
  }
}

// ---------- SETUP ----------
void setup() {
  Serial.begin(115200);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // OLED
  if (!display.begin(0x3C, true)) {
    Serial.println("OLED allocation failed");
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.print("Booting Scale...");
  display.display();

  // Crypto chip
  display.setCursor(0, 15);
  if (!ECCX08.begin()) {
    display.print("CRYPTO CHIP MISSING!");
    display.display();
    while (1);
  }
  chipSerialNumber = ECCX08.serialNumber();
  display.print("Crypto ID OK");
  display.display();

  // WiFi
  display.setCursor(0, 30);
  display.print("WiFi...");
  display.display();
  bool wifiOk = connectWiFi(15000);
  display.print(wifiOk ? " OK" : " FAILED");
  display.setCursor(0, 45);
  display.print(wifiOk ? WiFi.localIP().toString() : "will keep retrying");
  display.display();
  delay(1500);

  // Load cell (keep the scale EMPTY while it zeroes)
  scale.begin(LOADCELL_DT_PIN, LOADCELL_SCK_PIN);
  scale.set_scale(calibration_factor);
  scale.tare();

  // Hall sensor (last, so boot-up noise cannot trigger it)
  pinMode(HALL_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(HALL_PIN), triggerLockdown, CHANGE);

  statusText = "Place an item";
}

// ---------- MAIN LOOP ----------
void loop() {
  if (isLocked) {
    handleLockdown();
  }

  float w = scale.get_units(5);
  if (w < 0.0) w = 0.0;
  lastWeight = w;
  addHistory(w);

  String wStr = String(w, 2);
  String hash = sha256Hex(wStr + "kg");

  if (w < MIN_WEIGHT) {
    lastSentWeight = 0.0;                          // scale empty: ready for next item
    statusText = "Place an item";
  } else if (!isStable()) {
    statusText = "Settling...";
  } else if (fabs(w - lastSentWeight) >= CHANGE_MIN) {
    if (millis() - lastAttempt >= RETRY_MS || lastAttempt == 0) {
      statusText = "Sending...";
      drawMain(w, hash);
      long id = sendReading(wStr, hash, false);
      lastAttempt = millis();
      if (id >= 0) {
        lastSentWeight = w;
        statusText = "Saved to ledger";
        if (triggerCamera(id)) statusText = "Saved + photo";
      } else {
        statusText = "Send failed";
      }
    }
  }

  drawMain(w, hash);
  delay(100);
}
