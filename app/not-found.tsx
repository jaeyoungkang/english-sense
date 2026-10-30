import { SiteFooter, SiteHeader, SiteOutline } from "@/components/site-shell";

export default function NotFound() {
  return (
    <div className="public-app">
      <SiteHeader />
      <div className="public-layout">
        <SiteOutline />
        <div className="public-page">
          <main className="wrap" id="main-content">
            <header className="hero">
              <span className="eyebrow">404</span>
              <h1>페이지를 찾을 수 없습니다</h1>
              <p className="lede">주소를 다시 확인하거나 아래에서 읽을 이야기·학습 자료를 골라 보십시오.</p>
              <div className="actions">
                <a className="btn" href="/">첫 화면으로</a>
                <a className="btn ghost" href="/reading/">이야기 읽기 목록</a>
                <a className="btn ghost" href="/prep/">사전 훈련 목록</a>
              </div>
            </header>
            <section aria-labelledby="not-found-links-h">
              <h2 id="not-found-links-h">바로 가기</h2>
              <div className="links">
                <a className="link-card" href="/reading/">
                  <span className="t">이야기 읽기 (`/reading/`)</span>
                  <span className="s">짧은 영어 이야기 15편을 읽고 7개 퀴즈로 영어 감각을 훈련합니다</span>
                </a>
                <a className="link-card" href="/prep/">
                  <span className="t">책·영화 사전 훈련 (`/prep/`)</span>
                  <span className="s">원서와 영화에 자주 나오는 표현을 뜻과 힌트로 떠올려 빈칸을 채웁니다</span>
                </a>
                <a className="link-card" href="/practice/">
                  <span className="t">장면 연습 (`/practice/`)</span>
                  <span className="s">기본동사 have·get·be·go·come의 감각을 영화 장면 퀴즈로 연습합니다</span>
                </a>
                <a className="link-card" href="/ask/">
                  <span className="t">문장 해설기 (`/ask/`)</span>
                  <span className="s">궁금한 영어 문장의 감각을 풀이하거나 한국어를 자연스러운 영어로 옮깁니다</span>
                </a>
              </div>
            </section>
          </main>
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
