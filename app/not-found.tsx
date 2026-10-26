import { SiteFooter, SiteHeader } from "@/components/site-shell";
export default function NotFound() {
  return <><SiteHeader /><main className="wrap" id="main-content"><header className="hero"><span className="eyebrow">404</span><h1>페이지를 찾을 수 없습니다</h1><p className="lede">주소를 확인하거나 첫 화면에서 읽을 내용을 골라 보십시오.</p><div className="actions"><a className="btn" href="/">첫 화면으로</a></div></header></main><SiteFooter /></>;
}
