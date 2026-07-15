function f(){let e=globalThis.InfiniteCanvasRuntime;if(!e)throw new Error("[plugin-sdk] Infinite Canvas \u8FD0\u884C\u65F6\u672A\u5C31\u7EEA:\u8BF7\u5728\u753B\u5E03\u5BBF\u4E3B\u4E2D\u52A0\u8F7D\u672C\u63D2\u4EF6");return e}function r(){return f().React}var c=((...e)=>r().useState(...e)),p=((...e)=>r().useEffect(...e));var l=((...e)=>r().useMemo(...e));var g=`.cnv-md {
    height: 100%;
    width: 100%;
    overflow: auto;
    padding: 16px;
    font-size: 14px;
    line-height: 1.6;
}
.cnv-md h1,
.cnv-md h2,
.cnv-md h3 {
    margin: 0.6em 0 0.3em;
    font-weight: 600;
    line-height: 1.3;
}
.cnv-md h1 {
    font-size: 1.5em;
}
.cnv-md h2 {
    font-size: 1.3em;
}
.cnv-md p {
    margin: 0.5em 0;
}
.cnv-md a {
    color: #6366f1;
    text-decoration: underline;
}
.cnv-md code {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: rgba(120, 120, 120, 0.16);
    font-family: monospace;
    font-size: 0.9em;
}
.cnv-md pre {
    padding: 12px;
    border-radius: 8px;
    background: rgba(120, 120, 120, 0.14);
    overflow: auto;
}
.cnv-md pre code {
    padding: 0;
    background: transparent;
}
.cnv-md ul,
.cnv-md ol {
    padding-left: 1.4em;
    margin: 0.5em 0;
}
.cnv-md blockquote {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid rgba(120, 120, 120, 0.4);
    opacity: 0.85;
}
.cnv-md img {
    max-width: 100%;
}
`;var v=Symbol.for("infinite-canvas.jsx.fragment");function h(e,n,a){let i=r(),d=e===v?i.Fragment:e,s=a===void 0?n:{...n??{},key:a};return i.createElement(d,s)}function u(e,n,a){return h(e,n,a)}var k=u;var o,m;function b(){return o?Promise.resolve(o):(m||(m=import("https://esm.sh/marked@14").then(e=>o=e.marked)),m)}function C({ctx:e}){let[n,a]=c(!1),[i,d]=c(!!o),s=e.node.metadata?.content||"";p(()=>{if(o)return;let t=!0;return b().then(()=>t&&d(!0)),()=>{t=!1}},[]);let y=l(()=>o?o.parse(s||"*\u53CC\u51FB\u53F3\u4E0A\u89D2\u6309\u94AE\u7F16\u8F91 Markdown*"):"",[s,i]),R={position:"absolute",right:8,top:8,zIndex:20,width:32,height:32,display:"grid",placeItems:"center",borderRadius:8,border:`1px solid ${e.theme.node.stroke}`,background:`${e.theme.toolbar.panel}dd`,color:e.theme.node.text,cursor:"pointer"};return k("div",{"data-canvas-no-zoom":!0,onMouseDown:t=>t.stopPropagation(),style:{position:"relative",height:"100%",width:"100%",display:"flex",flexDirection:"column"},children:[u("button",{type:"button",style:R,onClick:()=>a(t=>!t),title:n?"\u9884\u89C8":"\u7F16\u8F91",children:n?"\u{1F441}":"\u270E"}),n?u("textarea",{autoFocus:!0,value:s,placeholder:"# \u8F93\u5165 Markdown",onChange:t=>e.updateMetadata({content:t.target.value}),onWheel:t=>t.stopPropagation(),style:{height:"100%",width:"100%",resize:"none",background:"transparent",padding:16,fontFamily:"monospace",fontSize:14,outline:"none",border:"none",color:e.theme.node.text}}):u("div",{className:"cnv-md",onWheel:t=>t.stopPropagation(),style:{color:e.theme.node.text},dangerouslySetInnerHTML:{__html:y}})]})}var _={id:"markdown",name:"Markdown \u8282\u70B9",version:"1.0.0",description:"\u5728\u753B\u5E03\u4E2D\u7F16\u8F91\u4E0E\u6E32\u67D3 Markdown",css:g,nodes:[{type:"markdown:doc",title:"Markdown",icon:"\u{1F4DD}",description:"\u7F16\u8F91\u4E0E\u6E32\u67D3 Markdown",defaultSize:{width:360,height:300},defaultMetadata:{content:""},minimapColor:"#6366f1",resource:e=>({kind:"text",text:e.metadata?.content}),Content:C}]};export{_ as default};
