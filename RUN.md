# Emotional Space AI — 실행 방법

## 데스크톱에서 서버 실행

### 1. 환경변수 설정 (PowerShell)

```powershell
cd "c:\Users\user\Desktop\Spatial Environment Agent"

# Google Cloud Vision API (필수)
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\your\google_key.json"

# Tapo 조명
$env:TAPO_USERNAME = "your_tapo_email@example.com"
$env:TAPO_PASSWORD = "your_tapo_password"
$env:TAPO_IPS = "192.168.1.100"
```

### 2. 패키지 설치 및 실행

```powershell
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 3. 데스크톱 IP 확인

```powershell
ipconfig | findstr "IPv4"
# 예: 192.168.0.10
```

---

## 태블릿에서 접속

1. **데스크톱과 태블릿을 같은 Wi-Fi에 연결**
2. 태블릿 Chrome에서 `http://192.168.0.10:8000` 접속 (IP는 위에서 확인한 값)
3. **TOUCH TO START** 클릭 → 카메라·마이크 권한 허용
4. 라이브 미리보기 + 얼굴 박스 + 감정 퍼센트 + 시스템 모드 확인

---

## 체크리스트

- [ ] Google Cloud Vision API 키 설정
- [ ] Tapo 계정·IP 설정
- [ ] 데스크톱·태블릿 같은 Wi-Fi
- [ ] 방화벽에서 8000 포트 허용 (필요 시)
