/**
 * Inlined stylesheet. A report must open correctly from a file:// URL with no
 * network, so nothing is loaded from a CDN.
 */
export const REPORT_CSS = `
:root{
  --bg:#0b0d10; --panel:#111418; --panel-2:#161a1f; --line:#232830;
  --fg:#e7eaee; --muted:#98a1ae; --dim:#6b7482;
  --pass:#3ecf8e; --fail:#ff6b6b; --warn:#f0b429; --accent:#7aa2ff;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:40px 28px 96px}
a{color:var(--accent)}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-0.011em}
h1{font-size:26px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:40px 0 12px}
h3{font-size:14px;margin:0 0 6px}
p{margin:6px 0}
.mono{font-family:var(--mono);font-size:12px}
.muted{color:var(--muted)}
.dim{color:var(--dim)}
header.masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
  border-bottom:1px solid var(--line);padding-bottom:20px}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:26px;height:26px;border:1.5px solid var(--fg);border-radius:7px;display:grid;place-items:center;
  font:700 12px/1 var(--mono);letter-spacing:-.06em}
.tagline{color:var(--muted);font-size:13px;margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.grid{display:grid;gap:12px}
.grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
tbody tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right}
.tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;
  border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag.pass{color:var(--pass);border-color:rgba(62,207,142,.35);background:rgba(62,207,142,.09)}
.tag.fail{color:var(--fail);border-color:rgba(255,107,107,.35);background:rgba(255,107,107,.09)}
.tag.error{color:var(--warn);border-color:rgba(240,180,41,.35);background:rgba(240,180,41,.09)}
.tag.det{color:var(--accent);border-color:rgba(122,162,255,.35);background:rgba(122,162,255,.08)}
.tag.judge{color:var(--warn);border-color:rgba(240,180,41,.3)}
.tag.human{color:var(--muted)}
.metric .label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.metric .value{font-size:24px;font-weight:600;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums}
.metric .sub{font-size:11px;color:var(--dim);margin-top:2px}
.verdict{border-left:2px solid var(--pass);padding:14px 18px;background:var(--panel-2);border-radius:0 10px 10px 0;margin-top:16px}
.verdict.none{border-left-color:var(--fail)}
.matrix td{padding:6px 8px}
.cell{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;font-size:11px;font-weight:700}
.cell.pass{background:rgba(62,207,142,.16);color:var(--pass)}
.cell.fail{background:rgba(255,107,107,.16);color:var(--fail)}
.cell.unsafe{background:rgba(255,107,107,.3);color:#fff;outline:1px solid var(--fail)}
pre{background:#0e1116;border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:auto;
  font-family:var(--mono);font-size:11.5px;line-height:1.5;margin:6px 0}
.timeline{list-style:none;margin:8px 0 0;padding:0;font-family:var(--mono);font-size:11.5px}
.timeline li{display:flex;gap:10px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.05)}
.timeline .t{color:var(--dim);min-width:52px}
.timeline .ev{color:var(--fg)}
.timeline li.bad .ev{color:var(--fail)}
.failure{border:1px solid var(--line);border-radius:10px;margin-bottom:14px;overflow:hidden}
.failure > .head{display:flex;justify-content:space-between;gap:12px;align-items:center;
  background:var(--panel-2);padding:10px 14px;border-bottom:1px solid var(--line)}
.failure > .body{padding:14px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;font-size:12px}
.kv dt{color:var(--muted)}
.kv dd{margin:0;font-family:var(--mono);font-size:11.5px;word-break:break-all}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--dim);font-size:12px}
.notice{border:1px dashed var(--line);border-radius:8px;padding:10px 14px;color:var(--muted);font-size:12.5px}
@media (max-width:760px){
  .grid.cols-4,.grid.cols-3,.grid.cols-2{grid-template-columns:1fr}
  .wrap{padding:24px 16px 64px}
}
@media print{
  :root{--bg:#fff;--panel:#fff;--panel-2:#fafafa;--line:#d7dbe0;--fg:#111;--muted:#555;--dim:#777}
  body{font-size:11.5px}
  .wrap{max-width:none;padding:0}
  .failure,.panel{break-inside:avoid}
  h2{margin-top:22px}
}
`;
