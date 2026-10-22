/*
  Proof of Fair Weight - ESP32-CAM photo node  (AI-Thinker ESP32-CAM)

  The scale board tells this board "take a photo for reading #123".
  This board takes one JPEG and uploads it to your website over HTTPS.

  Arduino IDE settings:
    Board:             "AI Thinker ESP32-CAM"
    Partition Scheme:  "Huge APP (3MB No OTA/1MB SPIFFS)"
    Upload with the ESP32-CAM-MB board (USB cable). No extra libraries needed.
*/
#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>

// ================== EDIT THESE 4 THINGS ==================
const char* WIFI_SSID       = "YOUR_WIFI_NAME";
const char* WIFI_PASS       = "YOUR_WIFI_PASSWORD";
const char* SERVER_BASE_URL = "https://YOUR-APP.vercel.app";   // no slash at the end
const char* API_KEY         = "PASTE_YOUR_DEVICE_API_KEY";      // same as DEVICE_API_KEY
// =========================================================

const bool USE_FLASH = false;       // true = use the white LED as a flash
const int  FLASH_PIN = 4;

// --- AI-Thinker ESP32-CAM pins ---
#define PWDN_GPIO_NUM   32
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM    0
#define SIOD_GPIO_NUM   26
#define SIOC_GPIO_NUM   27
#define Y9_GPIO_NUM     35
#define Y8_GPIO_NUM     34
#define Y7_GPIO_NUM     39
#define Y6_GPIO_NUM     36
#define Y5_GPIO_NUM     21
#define Y4_GPIO_NUM     19
#define Y3_GPIO_NUM     18
#define Y2_GPIO_NUM      5
#define VSYNC_GPIO_NUM  25
#define HREF_GPIO_NUM   23
#define PCLK_GPIO_NUM   22

WebServer server(80);

const int QUEUE_SIZE = 4;
long photoQueue[QUEUE_SIZE];
int  queueCount = 0;

bool startCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk  = XCLK_GPIO_NUM;
  config.pin_pclk  = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href  = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;   // if this line fails to compile, rename to pin_sscb_sda
  config.pin_sccb_scl = SIOC_GPIO_NUM;   // ...and this one to pin_sscb_scl
  config.pin_pwdn  = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;      // 640x480
    config.jpeg_quality = 12;                 // 10 = best, 63 = smallest
    config.fb_count     = 1;
    config.fb_location  = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size   = FRAMESIZE_QVGA;     // 320x240
    config.jpeg_quality = 15;
    config.fb_count     = 1;
    config.fb_location  = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  return true;
}

bool connectWiFi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

// 200 = saved, 409 = this reading already has its photo (also fine)
bool uploadPhoto(long readingId, camera_fb_t* fb) {
  if (!connectWiFi(8000)) return false;
  WiFiClientSecure client;
  client.setInsecure();   // prototype: encrypted, but the server certificate is not checked
  HTTPClient http;
  String url = String(SERVER_BASE_URL) + "/api/photos?reading_id=" + String(readingId);
  http.begin(client, url);
  http.setTimeout(20000);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", API_KEY);
  int code = http.POST(fb->buf, fb->len);
  Serial.printf("Photo for reading %ld (%u bytes) -> HTTP %d\n", readingId, (unsigned)fb->len, code);
  http.end();
  return code == 200 || code == 409;
}

void processPhoto(long readingId) {
  if (USE_FLASH) digitalWrite(FLASH_PIN, HIGH);
  for (int i = 0; i < 2; i++) {                    // let auto-exposure settle
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(60);
  }
  camera_fb_t* fb = esp_camera_fb_get();
  if (USE_FLASH) digitalWrite(FLASH_PIN, LOW);
  if (!fb) {
    Serial.println("Capture failed");
    return;
  }
  bool ok = false;
  for (int attempt = 0; attempt < 3 && !ok; attempt++) {
    ok = uploadPhoto(readingId, fb);
    if (!ok) delay(1500);
  }
  esp_camera_fb_return(fb);
}

// The scale board calls:  http://<this-ip>/snap?id=123   (with the X-API-Key header)
void handleSnap() {
  if (server.header("X-API-Key") != String(API_KEY)) {
    server.send(401, "text/plain", "bad key");
    return;
  }
  long id = server.arg("id").toInt();
  if (id <= 0) {
    server.send(400, "text/plain", "bad id");
    return;
  }
  if (queueCount >= QUEUE_SIZE) {
    server.send(503, "text/plain", "busy");
    return;
  }
  photoQueue[queueCount++] = id;
  server.send(202, "text/plain", "accepted");      // answer fast; the photo is taken in loop()
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_PIN, OUTPUT);
  digitalWrite(FLASH_PIN, LOW);

  if (!startCamera()) {
    Serial.println("Camera not working. Check the camera ribbon cable, then press RESET.");
    while (true) delay(1000);
  }
  if (!connectWiFi(20000)) {
    Serial.println("WiFi failed - will keep retrying");
  }
  Serial.println();
  Serial.println("=========================================");
  Serial.print  ("Camera ready. Put this in the scale sketch:  CAM_IP = \"");
  Serial.print(WiFi.localIP());
  Serial.println("\"");
  Serial.println("=========================================");

  const char* headers[] = {"X-API-Key"};
  server.collectHeaders(headers, 1);
  server.on("/snap", HTTP_GET, handleSnap);
  server.begin();
}

void loop() {
  server.handleClient();

  if (WiFi.status() != WL_CONNECTED) connectWiFi(5000);

  if (queueCount > 0) {
    long id = photoQueue[0];
    for (int i = 1; i < queueCount; i++) photoQueue[i - 1] = photoQueue[i];
    queueCount--;
    processPhoto(id);
  }
  delay(5);
}
