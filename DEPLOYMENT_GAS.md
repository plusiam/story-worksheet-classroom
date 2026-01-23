# Google Apps Script 배포 가이드 (학급 모드)

## 📋 개요

이 문서는 Story Worksheet Classroom (학급 모드)의 Google Apps Script 배포를 안내합니다.

---

## 1. Google 스프레드시트 생성

### 1.1 새 스프레드시트 만들기

1. [Google Drive](https://drive.google.com) 접속
2. "새로 만들기" → "Google 스프레드시트" → "빈 스프레드시트"
3. 이름 변경: `스토리 구성 학습지 - 학급 모드`

### 1.2 시트 설정

다음 시트를 생성:

#### 시트 1: `학생목록`
| A (이름) | B (번호) | C (PIN) |
|----------|----------|---------|
| 홍길동  | 1        |         |
| 김철수  | 2        |         |

- A열: 학생 이름
- B열: 번호 (1, 2, 3...)
- C열: PIN (학생이 최초 로그인 시 자동 생성)

#### 시트 2: `작품목록`
| A (학생이름) | B (번호) | C (단계) | D (작품데이터) |
|--------------|----------|----------|----------------|
|              |          |          |                |

- 이 시트는 자동으로 데이터가 채워집니다

---

## 2. Apps Script 프로젝트 생성

### 2.1 Apps Script Editor 열기

스프레드시트에서:
1. 상단 메뉴 → "확장 프로그램" → "Apps Script"
2. 새 프로젝트 생성됨
3. 프로젝트 이름 변경: `story-worksheet-classroom`

### 2.2 파일 구조 설정

Apps Script Editor에서 기본 `Code.gs` 파일 제거 후, 다음 파일들을 생성:

**서버 파일 (.gs)**:
- `Code.gs` - 메인 진입점
- `Auth.gs` - 인증 관리
- `Student.gs` - 학생 데이터 관리
- `Work.gs` - 작품 저장/불러오기
- `Ttori.gs` - AI 힌트 생성 (Gemini API)
- `Router.gs` - 라우팅
- `Database.gs` - 스프레드시트 DB 액세스
- `Utils.gs` - 유틸리티 함수

**클라이언트 파일 (.html)**:
- `Index.html` - 로그인 페이지
- `StudentMain.html` - 학생 메인 화면
- `StoryCreatorStep1.html` - Step 1: 이야기 구상
- `StoryCreatorStep2.html` - Step 2: 장면 확장
- `StoryCreatorStep3.html` - Step 3: 내 그림으로 완성
- `Css.html` - 공통 CSS
- `JavaScript.html` - 공통 JavaScript

---

## 3. 코드 배포

### 방법 1: 수동 복사 (초보자 추천)

1. 로컬의 `story-worksheet-classroom/` 폴더 열기
2. 각 `.gs` 파일 내용을 복사하여 Apps Script Editor에 동일한 이름으로 생성
3. 각 `.html` 파일 내용을 복사하여 Apps Script Editor에 HTML 파일로 추가

### 방법 2: clasp CLI (고급 사용자)

#### 2.1 clasp 설치

```bash
npm install -g @google/clasp
```

#### 2.2 Google 로그인

```bash
clasp login
```

브라우저에서 Google 계정 로그인 및 권한 승인

#### 2.3 프로젝트 연결

**기존 프로젝트 사용 (위에서 생성한 경우)**:

```bash
cd story-worksheet-classroom

# Apps Script 프로젝트 ID 확인
# Apps Script Editor → 프로젝트 설정 → Script ID 복사

# .clasp.json 파일 생성
cat > .clasp.json << EOF
{
  "scriptId": "<your-script-id>",
  "rootDir": "."
}
EOF
```

**또는 새 프로젝트 생성**:

```bash
cd story-worksheet-classroom
clasp create --type standalone --title "Story Worksheet Classroom"
```

#### 2.4 코드 푸시

```bash
clasp push
```

확인 메시지:
```
? Manifest file has been updated. Do you want to push and overwrite? Yes
└─ Pushed 20 files.
```

#### 2.5 온라인 에디터 열기

```bash
clasp open
```

---

## 4. Script Properties 설정

### 4.1 Gemini API 키 설정 (선택사항)

AI 그림 힌트 기능을 사용하려면:

1. [Google AI Studio](https://makersuite.google.com/app/apikey) 접속
2. "Create API Key" 클릭
3. API 키 복사

Apps Script Editor:
1. 프로젝트 설정 (톱니바퀴 아이콘)
2. "Script Properties" 섹션
3. "Add script property" 클릭
4. 속성 추가:
   - **Property**: `GEMINI_API_KEY`
   - **Value**: `<your-api-key>`

**주의**: API 키를 코드에 직접 넣지 마세요!

---

## 5. 웹 앱 배포

### 5.1 배포 설정

Apps Script Editor:
1. 상단 "배포" 버튼 클릭
2. "새 배포" 선택
3. 유형 선택: "웹 앱"

### 5.2 배포 설정 입력

**설명**: `학급 모드 v1.0 - 초기 배포`

**실행 계정**: **나**
- 스크립트가 본인의 권한으로 실행됩니다
- 스프레드시트 접근 권한이 필요합니다

**액세스 권한**: 다음 중 선택

| 옵션 | 설명 | 추천 |
|------|------|------|
| **모든 사람** | 인터넷의 모든 사람이 접근 가능 | ⚠️ 공개 학급용 |
| **모든 Google 계정 사용자** | Google 로그인한 사용자만 접근 | ✅ 일반 학급 권장 |
| **조직 내부 사용자** | Google Workspace 조직 내 사용자만 | ✅ 학교/기관용 |

일반적으로 **"모든 Google 계정 사용자"** 선택 권장

### 5.3 배포 실행

1. "배포" 버튼 클릭
2. 권한 승인 요청 시:
   - "권한 검토" 클릭
   - Google 계정 선택
   - "고급" → "안전하지 않은 페이지로 이동" (본인 스크립트이므로 안전)
   - "허용" 클릭

3. 배포 완료 후 **웹 앱 URL** 복사:
   ```
   https://script.google.com/macros/s/<deployment-id>/exec
   ```

---

## 6. 학생 등록 및 테스트

### 6.1 학생 목록 입력

스프레드시트의 `학생목록` 시트:

| A (이름) | B (번호) | C (PIN) |
|----------|----------|---------|
| 홍길동  | 1        |         |
| 김철수  | 2        |         |
| 이영희  | 3        |         |

- 이름과 번호만 입력
- PIN은 학생이 최초 로그인 시 자동 생성됩니다

### 6.2 웹 앱 테스트

1. 배포된 웹 앱 URL 접속
2. 학생 정보 입력:
   - 이름: `홍길동`
   - 번호: `1`
   - PIN: (처음이므로 입력 안 함)
3. "PIN 생성" 버튼 클릭
4. 생성된 4자리 PIN 확인 및 저장
5. 로그인 테스트

### 6.3 기능 테스트

- [ ] Step 1: 이야기 구상하기
- [ ] Step 2: 장면 확장하기 (드래그앤드롭)
- [ ] Step 3: 내 그림으로 완성하기
- [ ] AI 그림 힌트 (Gemini API 키 필요)
- [ ] HTML 다운로드
- [ ] 작품 저장/불러오기

---

## 7. 버전 관리 및 업데이트

### 7.1 새 버전 배포

코드 수정 후:

1. Apps Script Editor → "배포" → "배포 관리"
2. 기존 배포 옆 연필 아이콘 클릭
3. "새 버전" 선택
4. 설명 입력: `v1.1 - 모달 드래그 기능 추가`
5. "배포" 클릭

**중요**: 웹 앱 URL은 변경되지 않습니다 (학생들에게 재공유 불필요)

### 7.2 clasp를 사용한 배포 (선택사항)

```bash
# 코드 수정 후 푸시
clasp push

# 새 버전 배포
clasp deploy --description "v1.1 - 모달 드래그 기능 추가"
```

---

## 8. 권한 및 보안

### 8.1 필요한 권한

이 앱은 다음 권한을 요청합니다:

- ✅ **Google 스프레드시트**: 학생 정보 및 작품 저장
- ✅ **외부 서비스 연결**: Gemini API (AI 힌트)
- ✅ **스크립트 웹 앱 실행**

### 8.2 보안 권장사항

#### 학생 데이터 보호
- 스프레드시트 공유 권한: **"편집자"** 권한 최소화
- 학생 개인정보 수집 금지 (이름, 번호만 사용)
- 정기적인 데이터 백업

#### API 키 보안
- Script Properties에만 저장 (코드에 직접 입력 금지)
- 정기적인 API 키 교체
- 사용량 모니터링 (Google AI Studio Dashboard)

#### 스프레드시트 백업
```bash
# Google Drive에서 "사본 만들기"로 백업
# 또는 Apps Script로 자동 백업 설정
```

---

## 9. 학생용 사용 가이드 공유

### 9.1 학급 공지사항 템플릿

```
📚 스토리 구성 학습지 - 학급 모드 안내

[웹 앱 주소]
https://script.google.com/macros/s/<deployment-id>/exec

[로그인 방법]
1. 위 주소 접속
2. 본인 이름과 번호 입력
3. 처음이면 "PIN 생성" 클릭하여 4자리 PIN 받기
4. 받은 PIN을 잘 기억해두세요!

[작품 만들기]
1. 로그인 후 "새 작품 시작" 클릭
2. Step 1: 이야기 아이디어 구상
3. Step 2: 장면 확장하기
4. Step 3: 내 그림으로 완성하기

[도움말]
- PIN을 잊어버렸다면 선생님께 문의하세요
- 작품은 자동으로 저장됩니다
```

### 9.2 PIN 관리

학생이 PIN을 잊어버린 경우:

1. 스프레드시트 `학생목록` 시트 열기
2. 해당 학생의 C열 (PIN) 삭제
3. 학생이 다시 로그인 → "PIN 생성" 클릭

---

## 10. 모니터링 및 유지보수

### 10.1 사용 현황 확인

**스프레드시트 확인**:
- `작품목록` 시트에서 저장된 작품 수 확인
- 학생별 작품 진행 상황 파악

**Apps Script 로그**:
```bash
# clasp 사용 시
clasp logs
```

또는 Apps Script Editor → "실행" → "실행 로그"

### 10.2 오류 모니터링

Apps Script Editor → "실행" → "실행 로그"에서:
- 오류 발생 시간 확인
- 오류 메시지 분석
- 스택 트레이스 검토

### 10.3 성능 최적화

**스프레드시트 최적화**:
- 주기적으로 오래된 작품 삭제 또는 아카이브
- 시트 크기 모니터링 (1000행 이상 시 분리 고려)

**코드 최적화**:
- Lock Service로 동시 접근 제어 (이미 적용됨)
- Batch Write로 DB 쓰기 최소화 (이미 적용됨)

---

## 🔧 문제 해결

### 배포 실패
- **오류**: `You do not have permission`
- **해결**: 스프레드시트 소유자 권한 확인

### 학생 로그인 실패
- **오류**: `학생 정보를 찾을 수 없습니다`
- **해결**: 스프레드시트 `학생목록` 시트 확인 (이름, 번호 정확성)

### AI 힌트 실패
- **오류**: `API key not valid`
- **해결**: Script Properties의 `GEMINI_API_KEY` 확인
- **오류**: `Quota exceeded`
- **해결**: Gemini API 무료 할당량 초과, Pro 플랜 고려

### 작품 저장 실패
- **오류**: `Lock wait timeout`
- **해결**: 동시 접속 학생 수 확인, Lock Service 타임아웃 증가

---

## 📞 추가 지원

- [Google Apps Script 공식 문서](https://developers.google.com/apps-script)
- [clasp CLI 문서](https://github.com/google/clasp)
- [Gemini API 문서](https://ai.google.dev/docs)

---

**최종 업데이트**: 2026-01-23
