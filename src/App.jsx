import { useState, useMemo } from "react";

const RED = "#C0001A";
const RED_DARK = "#A0001A";
const RED_LIGHT = "#FFF0F2";
const RED_BORDER = "#F5C2C8";

const INIT_USERS = [
  { id:1, name:"관리자", email:"admin@eland.com", password:"1234", role:"admin", status:"승인", joinedAt:"2024-01-01" },
];

// ══════════════════════════════════════════════════════════
// YouTube API
// ══════════════════════════════════════════════════════════
const extractYouTubeId = (url="") => {
  const m1=url.match(/[?&]v=([^&]+)/); if(m1)return m1[1];
  const m2=url.match(/youtu\.be\/([^?&]+)/); if(m2)return m2[1];
  const m3=url.match(/shorts\/([^?&/]+)/); if(m3)return m3[1];
  const m4=url.match(/embed\/([^?&]+)/); if(m4)return m4[1];
  return null;
};

const fetchYouTubeStats = async (url, apiKey) => {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error("YouTube URL에서 영상 ID를 찾을 수 없습니다.");
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "YouTube API 오류");
  if (!data.items?.length) throw new Error("영상을 찾을 수 없습니다. URL을 확인해주세요.");
  const item = data.items[0];
  return {
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || "",
    views: parseInt(item.statistics.viewCount || 0),
    likes: parseInt(item.statistics.likeCount || 0),
    comments: parseInt(item.statistics.commentCount || 0),
    publishedAt: item.snippet.publishedAt?.slice(0,10) || "",
  };
};

// ══════════════════════════════════════════════════════════
// Apify Instagram 스크래퍼
// ══════════════════════════════════════════════════════════
const fetchInstagramStats = async (url, apifyToken) => {
  // 1. Actor 실행 요청
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${apifyToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: [url],
        resultsType: "posts",
        resultsLimit: 1,
        addParentData: false,
      }),
    }
  );
  if (!runRes.ok) {
    const e = await runRes.json().catch(()=>({}));
    throw new Error(e?.error?.message || "Apify 실행 실패. 토큰을 확인해주세요.");
  }
  const runData = await runRes.json();
  const runId = runData.data?.id;
  if (!runId) throw new Error("Apify Run ID를 받지 못했습니다.");

  // 2. 완료까지 폴링 (최대 60초, 3초 간격)
  for (let i=0; i<20; i++) {
    await new Promise(r=>setTimeout(r,3000));
    const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`);
    const stData = await st.json();
    const status = stData.data?.status;
    if (status==="SUCCEEDED") break;
    if (status==="FAILED"||status==="ABORTED") throw new Error("스크래핑 실패. URL이 올바른지, 공개 게시물인지 확인해주세요.");
    if (i===19) throw new Error("시간 초과 (60초). 잠시 후 다시 시도해주세요.");
  }

  // 3. 결과 조회
  const itemRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apifyToken}&limit=1`);
  if (!itemRes.ok) throw new Error("결과 데이터 조회 실패");
  const items = await itemRes.json();
  if (!items?.length) throw new Error("게시물 데이터를 찾을 수 없습니다. 비공개 계정이거나 삭제된 게시물일 수 있습니다.");

  const p = items[0];
  return {
    title: p.caption?.slice(0,120) || p.alt || "(캡션 없음)",
    thumbnail: p.displayUrl || p.thumbnailUrl || p.images?.[0] || "",
    views: p.videoViewCount || p.videoPlayCount || 0,
    likes: p.likesCount || p.likes || 0,
    comments: p.commentsCount || p.comments || 0,
    publishedAt: p.timestamp ? new Date(p.timestamp).toISOString().slice(0,10) : "",
  };
};

// ══════════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════════
const fmt = (n) => { if(!n)return"0"; if(n>=1000000)return(n/1000000).toFixed(1)+"M"; if(n>=1000)return(n/1000).toFixed(1)+"K"; return n.toLocaleString(); };
const fmtFull = (n) => (n||0).toLocaleString();
const detectPlatform = (url="") => {
  if(url.includes("youtube.com")||url.includes("youtu.be"))return"YouTube";
  if(url.includes("instagram.com/reel"))return"Instagram Reel";
  if(url.includes("instagram.com"))return"Instagram Post";
  if(url.includes("threads.net"))return"Threads";
  return"";
};
const platformStyle = (p="") => {
  if(p.includes("YouTube"))return{bg:"#FF0000",text:"#fff"};
  if(p.includes("Reel"))return{bg:"#9333EA",text:"#fff"};
  if(p.includes("Instagram"))return{bg:"#E1306C",text:"#fff"};
  if(p.includes("Threads"))return{bg:"#111827",text:"#fff"};
  return{bg:"#6B7280",text:"#fff"};
};
const statusStyle = (s="") => {
  if(s==="성공")return{bg:"#DCFCE7",text:"#166534"};
  if(s==="접근 제한")return{bg:"#F3F4F6",text:"#6B7280"};
  if(s==="실패")return{bg:"#FEE2E2",text:"#991B1B"};
  return{bg:"#F3F4F6",text:"#6B7280"};
};

// ══════════════════════════════════════════════════════════
// 공통 스타일
// ══════════════════════════════════════════════════════════
const C = {
  card:{background:"#fff",border:"1px solid "+RED_BORDER,borderRadius:12,padding:20},
  btnRed:{padding:"9px 20px",borderRadius:8,border:"none",background:RED,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"},
  btnGhost:{padding:"8px 16px",borderRadius:8,border:"1px solid "+RED_BORDER,background:RED_LIGHT,color:RED,fontSize:13,fontWeight:600,cursor:"pointer"},
  btnOutline:{padding:"8px 16px",borderRadius:8,border:"1px solid #E5E7EB",background:"#fff",color:"#374151",fontSize:13,fontWeight:600,cursor:"pointer"},
  inp:{display:"block",width:"100%",padding:"10px 14px",border:"1px solid #E5E7EB",borderRadius:8,fontSize:14,color:"#111827",background:"#fff",marginBottom:12,fontFamily:"inherit"},
  lbl:{display:"block",fontSize:12,fontWeight:700,color:"#374151",marginBottom:6},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20},
};

const PlatformBadge = ({p}) => { const s=platformStyle(p); return <span style={{display:"inline-block",padding:"2px 9px",borderRadius:20,background:s.bg,color:s.text,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{p||"미인식"}</span>; };
const StatusBadge = ({s}) => { const c=statusStyle(s); return <span style={{display:"inline-block",padding:"2px 9px",borderRadius:20,background:c.bg,color:c.text,fontSize:11,fontWeight:600}}>{s}</span>; };
const Thumb = ({src}) => (
  <div style={{width:56,height:40,borderRadius:6,background:RED_LIGHT,overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
    {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:18,color:RED}}>🎬</span>}
  </div>
);
const Spinner = ({size=16}) => <div style={{width:size,height:size,border:"2px solid "+RED_BORDER,borderTopColor:RED,borderRadius:"50%",animation:"spin 0.8s linear infinite",flexShrink:0}}/>;

// ══════════════════════════════════════════════════════════
// 로그인 / 회원가입
// ══════════════════════════════════════════════════════════
function AuthScreen({users,setUsers,onLogin}) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({name:"",email:"",password:""});
  const [err,setErr]=useState("");
  const [success,setSuccess]=useState("");
  const set=(k,v)=>{setForm(f=>({...f,[k]:v}));setErr("");};

  const handleLogin=()=>{
    const found=users.find(u=>u.email===form.email&&u.password===form.password);
    if(!found)return setErr("이메일 또는 비밀번호가 올바르지 않습니다.");
    if(found.status==="대기")return setErr("관리자 승인 대기 중입니다.");
    if(found.status==="거절")return setErr("접근이 거절된 계정입니다.");
    onLogin(found);
  };
  const handleSignup=()=>{
    if(!form.name.trim())return setErr("이름을 입력해주세요.");
    if(!form.email.includes("@"))return setErr("올바른 이메일을 입력해주세요.");
    if(users.find(u=>u.email===form.email))return setErr("이미 가입된 이메일입니다.");
    setUsers(prev=>[...prev,{id:Date.now(),name:form.name.trim(),email:form.email.trim(),password:"",role:"member",status:"대기",joinedAt:new Date().toISOString().slice(0,10)}]);
    setSuccess("가입 신청 완료! 관리자 승인 후 로그인 가능합니다.");
    setForm({name:"",email:"",password:""});
  };

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${RED} 0%,#7B000F 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{`*{box-sizing:border-box;}@keyframes spin{to{transform:rotate(360deg);}}input:focus{outline:none;border-color:${RED}!important;box-shadow:0 0 0 3px rgba(192,0,26,0.15);}`}</style>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:60,height:60,background:"rgba(255,255,255,0.15)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",border:"1px solid rgba(255,255,255,0.3)"}}>
            <span style={{fontSize:28}}>📊</span>
          </div>
          <div style={{fontSize:20,fontWeight:900,color:"#fff"}}>피카소 모니터링</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginTop:4}}>피카소 TF 전용 대시보드</div>
        </div>
        <div style={{background:"#fff",borderRadius:20,padding:"32px 36px",boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}}>
          <div style={{display:"flex",background:"#F3F4F6",borderRadius:10,padding:4,marginBottom:28}}>
            {[{key:"login",label:"로그인"},{key:"signup",label:"회원가입"}].map(t=>(
              <button key={t.key} onClick={()=>{setMode(t.key);setErr("");setSuccess("");setForm({name:"",email:"",password:""}); }}
                style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:mode===t.key?"#fff":"transparent",color:mode===t.key?RED:"#6B7280",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:mode===t.key?"0 1px 4px rgba(0,0,0,0.1)":"none",transition:"all 0.2s"}}>
                {t.label}
              </button>
            ))}
          </div>
          {err&&<div style={{background:"#FEE2E2",color:"#991B1B",padding:"10px 14px",borderRadius:8,fontSize:13,marginBottom:16,fontWeight:600}}>⚠️ {err}</div>}
          {success&&<div style={{background:"#DCFCE7",color:"#166534",padding:"10px 14px",borderRadius:8,fontSize:13,marginBottom:16,fontWeight:600}}>✅ {success}</div>}
          {mode==="login"?(
            <>
              <label style={C.lbl}>이메일</label>
              <input style={C.inp} type="email" value={form.email} onChange={e=>set("email",e.target.value)} placeholder="이메일을 입력하세요"/>
              <label style={C.lbl}>비밀번호</label>
              <input style={C.inp} type="password" value={form.password} onChange={e=>set("password",e.target.value)} placeholder="비밀번호를 입력하세요" onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
              <button style={{...C.btnRed,width:"100%",padding:"12px 0",fontSize:15}} onClick={handleLogin}>로그인</button>
            </>
          ):(
            <>
              <label style={C.lbl}>이름 *</label>
              <input style={C.inp} type="text" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="실명을 입력하세요"/>
              <label style={C.lbl}>이메일 *</label>
              <input style={C.inp} type="email" value={form.email} onChange={e=>set("email",e.target.value)} placeholder="이메일을 입력하세요" onKeyDown={e=>e.key==="Enter"&&handleSignup()}/>
              <p style={{fontSize:12,color:"#9CA3AF",margin:"0 0 20px",lineHeight:1.5}}>가입 신청 후 관리자 승인이 완료되면 로그인할 수 있습니다.</p>
              <button style={{...C.btnRed,width:"100%",padding:"12px 0",fontSize:15}} onClick={handleSignup}>가입 신청</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 설정 페이지 (관리자 전용)
// ══════════════════════════════════════════════════════════
function Settings({ytApiKey,setYtApiKey,apifyToken,setApifyToken,currentUser}) {
  const [ytInput,setYtInput]=useState(ytApiKey);
  const [igInput,setIgInput]=useState(apifyToken);
  const [ytTesting,setYtTesting]=useState(false);
  const [igTesting,setIgTesting]=useState(false);
  const [ytResult,setYtResult]=useState(null);
  const [igResult,setIgResult]=useState(null);
  const [saved,setSaved]=useState("");

  if(currentUser.role!=="admin") return(
    <div style={{...C.card,textAlign:"center",padding:60}}>
      <div style={{fontSize:48,marginBottom:16}}>🔒</div>
      <div style={{fontSize:18,fontWeight:700}}>관리자 전용 페이지입니다</div>
    </div>
  );

  const maskKey=(k)=>k?k.slice(0,8)+"••••••••••••••••"+k.slice(-4):"";

  const testYT=async()=>{
    if(!ytInput.trim())return setYtResult({ok:false,msg:"API 키를 먼저 입력해주세요."});
    setYtTesting(true);setYtResult(null);
    try{
      const res=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=${ytInput.trim()}`);
      const data=await res.json();
      if(data.error)throw new Error(data.error.message);
      setYtResult({ok:true,msg:"✅ YouTube API 키가 정상 작동합니다!"});
    }catch(e){setYtResult({ok:false,msg:"❌ "+e.message});}
    finally{setYtTesting(false);}
  };

  const testIG=async()=>{
    if(!igInput.trim())return setIgResult({ok:false,msg:"Apify 토큰을 먼저 입력해주세요."});
    setIgTesting(true);setIgResult(null);
    try{
      // 사용자 정보 조회로 토큰 유효성만 확인
      const res=await fetch(`https://api.apify.com/v2/users/me?token=${igInput.trim()}`);
      const data=await res.json();
      if(data.error||!data.data?.username)throw new Error(data.error?.message||"토큰이 유효하지 않습니다.");
      setIgResult({ok:true,msg:`✅ Apify 연결 성공! (계정: ${data.data.username})`});
    }catch(e){setIgResult({ok:false,msg:"❌ "+e.message});}
    finally{setIgTesting(false);}
  };

  const saveAll=()=>{
    setYtApiKey(ytInput.trim());
    setApifyToken(igInput.trim());
    setSaved("✅ 저장 완료!");
    setTimeout(()=>setSaved(""),3000);
  };

  const ApiCard=({title,subtitle,color,icon,inputVal,setInputVal,onTest,testing,result,children,link,linkLabel})=>(
    <div style={{...C.card,maxWidth:680,marginBottom:20,borderTop:`3px solid ${color}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <div style={{width:36,height:36,background:color,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{icon}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:15,fontWeight:800,color:"#111827"}}>{title}</div>
          <div style={{fontSize:12,color:"#6B7280"}}>{subtitle}</div>
        </div>
        {inputVal&&<span style={{padding:"3px 12px",borderRadius:20,background:"#DCFCE7",color:"#166534",fontSize:12,fontWeight:700}}>● 연결됨</span>}
      </div>
      {children}
      <label style={C.lbl}>토큰 / API 키</label>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input style={{...C.inp,marginBottom:0,flex:1,fontFamily:"monospace"}} type="password" value={inputVal} onChange={e=>{setInputVal(e.target.value);}} placeholder={`${title} 키 입력...`}/>
        <button style={{...C.btnOutline,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}} onClick={onTest} disabled={testing}>
          {testing&&<Spinner size={13}/>}{testing?"확인 중...":"연결 테스트"}
        </button>
      </div>
      {result&&<div style={{padding:"10px 14px",borderRadius:8,marginBottom:12,fontSize:13,fontWeight:600,background:result.ok?"#DCFCE7":"#FEE2E2",color:result.ok?"#166534":"#991B1B"}}>{result.msg}</div>}
      {link&&<a href={link} target="_blank" rel="noreferrer" style={{fontSize:12,color:RED,textDecoration:"none"}}>🔗 {linkLabel} →</a>}
    </div>
  );

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>설정</h1>
      <p style={{margin:"0 0 28px",fontSize:13,color:"#6B7280"}}>API 키 및 연동 설정 (관리자 전용)</p>

      {saved&&<div style={{padding:"12px 16px",borderRadius:10,marginBottom:20,fontSize:14,fontWeight:600,background:"#DCFCE7",color:"#166534"}}>{saved}</div>}

      {/* YouTube */}
      <ApiCard
        title="YouTube Data API v3" subtitle="조회수·좋아요·댓글 자동 수집" color="#FF0000" icon="▶️"
        inputVal={ytInput} setInputVal={setYtInput} onTest={testYT} testing={ytTesting} result={ytResult}
        link="https://console.cloud.google.com/apis/library/youtube.googleapis.com" linkLabel="Google Cloud Console">
        <div style={{padding:"12px 16px",background:"#F9FAFB",borderRadius:8,marginBottom:16,fontSize:12,color:"#6B7280",lineHeight:1.8}}>
          📋 <b>무료 할당량:</b> 하루 10,000 쿼리 · 영상 1개 = 쿼리 1개 · 200개 콘텐츠 기준 여유 있음
        </div>
      </ApiCard>

      {/* Instagram (Apify) */}
      <ApiCard
        title="Instagram 스크래퍼 (Apify)" subtitle="공개 계정 게시물 좋아요·댓글·조회수 수집" color="#E1306C" icon="📸"
        inputVal={igInput} setInputVal={setIgInput} onTest={testIG} testing={igTesting} result={igResult}
        link="https://console.apify.com/account/integrations" linkLabel="Apify 토큰 발급">
        <div style={{padding:"12px 16px",background:"#FFF0F5",border:"1px solid #FFC8D8",borderRadius:8,marginBottom:16,fontSize:12,color:"#9B1B40",lineHeight:1.8}}>
          ⚠️ <b>주의사항</b><br/>
          • 공개 계정만 수집 가능 (비공개 계정 불가)<br/>
          • 릴스 조회수는 간혹 누락될 수 있음<br/>
          • 게시물 1건당 약 $0.002 소모 · 첫 가입 시 $5 무료 크레딧 제공<br/>
          • 스레드(Threads)는 수동 입력 권장
        </div>
      </ApiCard>

      {/* Threads 안내 */}
      <div style={{...C.card,maxWidth:680,borderTop:"3px solid #111827",opacity:0.75}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <div style={{width:36,height:36,background:"#111827",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🧵</div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#111827"}}>Threads</div>
            <div style={{fontSize:12,color:"#6B7280"}}>수동 입력 권장</div>
          </div>
          <span style={{marginLeft:"auto",padding:"3px 12px",borderRadius:20,background:"#F3F4F6",color:"#6B7280",fontSize:12,fontWeight:700}}>자동화 불가</span>
        </div>
        <p style={{margin:0,fontSize:13,color:"#6B7280",lineHeight:1.6}}>
          Meta가 Threads 크롤링을 강하게 차단하고 있어 안정적인 자동 수집이 어렵습니다.<br/>
          콘텐츠 등록 시 조회수/좋아요를 직접 입력해주세요.
        </p>
      </div>

      <div style={{marginTop:24,maxWidth:680,display:"flex",justifyContent:"flex-end"}}>
        <button style={{...C.btnRed,padding:"11px 32px",fontSize:15}} onClick={saveAll}>전체 저장</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 콘텐츠 등록 모달
// ══════════════════════════════════════════════════════════
function RegisterModal({onAdd,onClose,ytApiKey,apifyToken}) {
  const [form,setForm]=useState({url:"",title:"",brand:"",campaign:"",manager:"",collaborator:"",uploadDate:"",memo:"",manualViews:"",manualLikes:"",manualComments:""});
  const [loading,setLoading]=useState(false);
  const [fetchErr,setFetchErr]=useState("");
  const [preview,setPreview]=useState(null);
  const detected=detectPlatform(form.url);
  const isYT=detected==="YouTube";
  const isIG=detected.includes("Instagram");
  const isThreads=detected==="Threads";
  const canAutoFetch=(isYT&&ytApiKey)||(isIG&&apifyToken);
  const set=(k,v)=>{setForm(f=>({...f,[k]:v}));if(k==="url"){setPreview(null);setFetchErr("");}};

  const handleUrlBlur=async()=>{
    if(!form.url||!canAutoFetch)return;
    setLoading(true);setFetchErr("");
    try{
      let s;
      if(isYT)s=await fetchYouTubeStats(form.url,ytApiKey);
      else if(isIG)s=await fetchInstagramStats(form.url,apifyToken);
      setPreview(s);
      if(!form.title)set("title",s.title);
      if(!form.uploadDate)set("uploadDate",s.publishedAt);
    }catch(e){setFetchErr(e.message);}
    finally{setLoading(false);}
  };

  const handleSave=async(autoFetch)=>{
    if(!form.url.trim())return alert("URL을 입력해주세요.");
    setLoading(true);
    let s=preview;
    if(autoFetch&&canAutoFetch&&!s){
      try{
        if(isYT)s=await fetchYouTubeStats(form.url,ytApiKey);
        else if(isIG)s=await fetchInstagramStats(form.url,apifyToken);
      }catch(e){setFetchErr(e.message);setLoading(false);return;}
    }
    onAdd({
      id:Date.now(),url:form.url.trim(),
      platform:detected||"Instagram Post",
      title:s?.title||form.title||"",
      thumbnail:s?.thumbnail||"",
      brand:form.brand,campaign:form.campaign,
      manager:form.manager,collaborator:form.collaborator,
      uploadDate:form.uploadDate||s?.publishedAt||new Date().toISOString().slice(0,10),
      memo:form.memo,
      views:s?.views||parseInt(form.manualViews)||0,
      likes:s?.likes||parseInt(form.manualLikes)||0,
      comments:s?.comments||parseInt(form.manualComments)||0,
      views24h:0,views7d:0,status:"성공",
    });
    setLoading(false);onClose();
  };

  const PreviewBox=()=>{
    if(loading)return(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px",background:"#fff",borderRadius:8,border:"1px solid "+RED_BORDER,marginTop:10}}>
        <Spinner/><div style={{fontSize:13,color:"#6B7280"}}>{isIG?"Instagram 데이터 수집 중... (최대 60초)":"YouTube 데이터 가져오는 중..."}</div>
      </div>
    );
    if(fetchErr)return(
      <div style={{padding:"10px 14px",background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:13,color:"#991B1B",marginTop:10}}>
        ⚠️ {fetchErr}
        {isIG&&<div style={{marginTop:6,fontSize:12}}>비공개 계정이거나 삭제된 게시물일 수 있습니다. 아래에서 수동으로 입력해주세요.</div>}
      </div>
    );
    if(preview)return(
      <div style={{padding:14,background:"#fff",borderRadius:10,border:"1px solid "+RED_BORDER,marginTop:10}}>
        <div style={{fontSize:11,color:"#16A34A",fontWeight:700,marginBottom:8}}>✅ 데이터 자동 가져옴</div>
        {preview.thumbnail&&<img src={preview.thumbnail} alt="" style={{width:"100%",borderRadius:6,marginBottom:8,display:"block"}}/>}
        <div style={{fontSize:12,fontWeight:600,color:"#111827",marginBottom:10,lineHeight:1.4}}>{preview.title}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {[{label:"조회수",value:fmtFull(preview.views)},{label:"좋아요",value:fmtFull(preview.likes)},{label:"댓글",value:fmtFull(preview.comments)}].map(s=>(
            <div key={s.label} style={{background:RED_LIGHT,borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
              <div style={{fontSize:10,color:"#6B7280"}}>{s.label}</div>
              <div style={{fontSize:13,fontWeight:800,color:RED}}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
    return null;
  };

  return(
    <div style={C.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",borderRadius:18,width:"92%",maxWidth:920,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(192,0,26,0.18)"}}>
        <div style={{padding:"22px 28px 18px",borderBottom:"2px solid "+RED_BORDER,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>콘텐츠 등록</h2>
            <p style={{margin:"4px 0 0",fontSize:13,color:RED}}>URL을 붙여넣으면 플랫폼 자동 인식 + 데이터 자동 수집</p>
          </div>
          <button style={{background:"none",border:"none",fontSize:22,color:"#9CA3AF",cursor:"pointer"}} onClick={onClose}>✕</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,padding:"24px 28px"}}>
          {/* 좌: URL + 미리보기 */}
          <div>
            <div style={{background:RED_LIGHT,borderRadius:12,padding:20,border:"1px solid "+RED_BORDER,marginBottom:16}}>
              <h3 style={{margin:"0 0 14px",fontSize:14,fontWeight:700}}>URL 및 자동 인식</h3>
              <label style={C.lbl}>URL *</label>
              <input style={C.inp} value={form.url} onChange={e=>set("url",e.target.value)} onBlur={handleUrlBlur}
                placeholder="youtube.com/... · instagram.com/... · threads.net/..."/>
              {form.url&&(
                <div style={{padding:"8px 12px",background:"#fff",border:"1px solid "+RED_BORDER,borderRadius:8,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:"#6B7280"}}>플랫폼:</span>
                  {detected?<PlatformBadge p={detected}/>:<span style={{fontSize:12,color:"#9CA3AF"}}>인식 불가</span>}
                  {canAutoFetch&&!preview&&!loading&&!fetchErr&&<span style={{fontSize:11,color:"#6B7280",marginLeft:"auto"}}>↑ 포커스 이동 시 자동 수집</span>}
                </div>
              )}
              <PreviewBox/>
            </div>

            {/* 수동 입력 (Threads 또는 실패 시) */}
            {(isThreads||fetchErr||(!canAutoFetch&&(isIG||isYT)))&&(
              <div style={{background:"#F9FAFB",borderRadius:12,padding:16,border:"1px solid #E5E7EB"}}>
                <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700,color:"#374151"}}>
                  {isThreads?"🧵 Threads — 수동 입력":"📝 수동 지표 입력"}
                </h3>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[{key:"manualViews",label:"조회수"},{key:"manualLikes",label:"좋아요"},{key:"manualComments",label:"댓글"}].map(f=>(
                    <div key={f.key}>
                      <label style={{...C.lbl,fontSize:11}}>{f.label}</label>
                      <input style={{...C.inp,marginBottom:0,fontSize:13,padding:"8px 10px"}} type="number" value={form[f.key]} onChange={e=>set(f.key,e.target.value)} placeholder="0"/>
                    </div>
                  ))}
                </div>
                {!canAutoFetch&&isYT&&<p style={{margin:"8px 0 0",fontSize:11,color:"#D97706"}}>💡 설정에서 YouTube API 키를 입력하면 자동으로 가져옵니다.</p>}
                {!canAutoFetch&&isIG&&<p style={{margin:"8px 0 0",fontSize:11,color:"#D97706"}}>💡 설정에서 Apify 토큰을 입력하면 자동으로 가져옵니다.</p>}
              </div>
            )}
          </div>

          {/* 우: 콘텐츠 정보 */}
          <div>
            <h3 style={{margin:"0 0 14px",fontSize:14,fontWeight:700}}>콘텐츠 정보</h3>
            <label style={C.lbl}>콘텐츠명</label>
            <input style={C.inp} value={form.title} onChange={e=>set("title",e.target.value)} placeholder="(YouTube·Instagram은 자동 입력)"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={C.lbl}>브랜드</label><input style={C.inp} value={form.brand} onChange={e=>set("brand",e.target.value)}/></div>
              <div><label style={C.lbl}>캠페인</label><input style={C.inp} value={form.campaign} onChange={e=>set("campaign",e.target.value)}/></div>
              <div><label style={C.lbl}>담당자</label><input style={C.inp} value={form.manager} onChange={e=>set("manager",e.target.value)}/></div>
              <div><label style={C.lbl}>협업자</label><input style={C.inp} value={form.collaborator} onChange={e=>set("collaborator",e.target.value)}/></div>
            </div>
            <label style={C.lbl}>업로드일</label>
            <input style={C.inp} type="date" value={form.uploadDate} onChange={e=>set("uploadDate",e.target.value)}/>
            <label style={C.lbl}>메모</label>
            <textarea style={{...C.inp,height:80,resize:"vertical"}} value={form.memo} onChange={e=>set("memo",e.target.value)}/>
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:10,padding:"0 28px 24px"}}>
          <button style={C.btnOutline} onClick={onClose}>취소</button>
          <button style={C.btnOutline} onClick={()=>handleSave(false)} disabled={loading}>저장만 하기</button>
          <button style={{...C.btnRed,opacity:loading?0.6:1,display:"flex",alignItems:"center",gap:8}} onClick={()=>handleSave(true)} disabled={loading}>
            {loading&&<Spinner size={14}/>}
            {loading?"수집 중...":"저장 + 최초 지표 가져오기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 대시보드
// ══════════════════════════════════════════════════════════
function Dashboard({contents,onOpenRegister}) {
  const total=contents.length;
  const totalViews=contents.reduce((s,c)=>s+(c.views||0),0);
  const today=contents.reduce((s,c)=>s+(c.views24h||0),0);
  const week=contents.reduce((s,c)=>s+(c.views7d||0),0);
  const topView=[...contents].sort((a,b)=>(b.views||0)-(a.views||0))[0];
  const topGrowth=[...contents].sort((a,b)=>(b.views7d||0)-(a.views7d||0))[0];
  const top24h=[...contents].sort((a,b)=>(b.views24h||0)-(a.views24h||0)).filter(i=>i.views24h>0).slice(0,10);
  const top7d=[...contents].sort((a,b)=>(b.views7d||0)-(a.views7d||0)).filter(i=>i.views7d>0).slice(0,10);

  if(total===0)return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>대시보드</h1>
      <p style={{margin:"0 0 28px",fontSize:13,color:"#6B7280"}}>전체 콘텐츠 성과 한눈에 보기</p>
      <div style={{...C.card,textAlign:"center",padding:"80px 24px"}}>
        <div style={{fontSize:60,marginBottom:18}}>📭</div>
        <div style={{fontSize:20,fontWeight:700,marginBottom:10}}>등록된 콘텐츠가 없습니다</div>
        <div style={{fontSize:14,color:"#6B7280",marginBottom:28}}>우측 상단 <b style={{color:RED}}>+ 콘텐츠 등록</b>으로 URL을 추가하면 성과가 표시됩니다.</div>
        <button style={C.btnRed} onClick={onOpenRegister}>+ 첫 콘텐츠 등록하기</button>
      </div>
    </div>
  );

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>대시보드</h1>
      <p style={{margin:"0 0 22px",fontSize:13,color:"#6B7280"}}>전체 콘텐츠 성과 한눈에 보기 · 등록 콘텐츠 {total}건</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
        {[
          {label:"전체 콘텐츠",value:total,icon:"📄"},
          {label:"누적 조회수",value:fmtFull(totalViews),sub:"전체 플랫폼 합계",icon:"👁"},
          {label:"오늘 증가",value:today>0?"+"+fmt(today):"—",icon:"📈",green:true},
          {label:"24시간 증가",value:today>0?"+"+fmt(today):"—",icon:"📈",green:true},
        ].map(s=>(
          <div key={s.label} style={{...C.card,padding:"16px 18px",borderTop:"3px solid "+RED}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#6B7280",fontWeight:600}}>{s.label}</span><span style={{fontSize:15}}>{s.icon}</span></div>
            <div style={{fontSize:26,fontWeight:800,color:s.green&&today>0?"#16A34A":"#111827",marginTop:6}}>{s.value}</div>
            {s.sub&&<div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{s.sub}</div>}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[
          {label:"7일 증가",value:week>0?"+"+fmt(week):"—",icon:"🔄",green:true},
          {label:"수동 입력 필요",value:contents.filter(c=>!c.views).length,icon:"⚠️"},
        ].map(s=>(
          <div key={s.label} style={{...C.card,padding:"16px 18px",borderTop:"3px solid "+RED}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#6B7280",fontWeight:600}}>{s.label}</span><span style={{fontSize:15}}>{s.icon}</span></div>
            <div style={{fontSize:26,fontWeight:800,color:s.green&&week>0?"#16A34A":"#111827",marginTop:6}}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
        {[
          {title:"최고 조회수 콘텐츠",item:topView,sub:v=>fmtFull(v.views)+" 회",color:"#111827"},
          {title:"🔥 가장 빠르게 성장",item:topGrowth?.views7d>0?topGrowth:null,sub:v=>"7일 +"+fmtFull(v.views7d),color:"#16A34A"},
        ].map(({title,item,sub,color})=>(
          <div key={title} style={C.card}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:14,borderLeft:"3px solid "+RED,paddingLeft:10}}>{title}</div>
            {item?(
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <Thumb src={item.thumbnail}/>
                <div><PlatformBadge p={item.platform}/>
                  <p style={{margin:"6px 0 4px",fontSize:14,fontWeight:600,lineHeight:1.4}}>{item.title||item.url}</p>
                  <p style={{margin:0,fontSize:13,color,fontWeight:700}}>{sub(item)}</p>
                </div>
              </div>
            ):<p style={{color:"#9CA3AF",fontSize:13}}>데이터가 아직 없습니다</p>}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[
          {title:"최근 24시간 급상승 Top 10",items:top24h,vk:"views24h"},
          {title:"최근 7일 급상승 Top 10",items:top7d,vk:"views7d"},
        ].map(({title,items,vk})=>(
          <div key={title} style={C.card}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:14,borderLeft:"3px solid "+RED,paddingLeft:10}}>{title}</div>
            {items.length===0?<p style={{color:"#9CA3AF",fontSize:13}}>집계 데이터가 없습니다</p>
            :items.map((item,i)=>(
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <span style={{width:18,fontSize:13,fontWeight:700,color:i<3?RED:"#9CA3AF"}}>{i+1}</span>
                <Thumb src={item.thumbnail}/>
                <div style={{flex:1,minWidth:0}}>
                  <PlatformBadge p={item.platform}/>
                  <p style={{margin:"3px 0 2px",fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.title||item.url}</p>
                  <StatusBadge s={item.status}/>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:"#16A34A",flexShrink:0}}>+{fmt(item[vk])}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 콘텐츠 목록
// ══════════════════════════════════════════════════════════
function ContentsList({contents,onOpenRegister}) {
  const [search,setSearch]=useState("");
  const [pfFilter,setPfFilter]=useState("전체");
  const [stFilter,setStFilter]=useState("전체");
  const [sortBy,setSortBy]=useState("최근 등록순");

  const filtered=useMemo(()=>{
    let r=[...contents];
    if(search)r=r.filter(c=>(c.title||c.url||"").toLowerCase().includes(search.toLowerCase()));
    if(pfFilter!=="전체")r=r.filter(c=>c.platform===pfFilter);
    if(stFilter!=="전체")r=r.filter(c=>c.status===stFilter);
    if(sortBy==="최근 등록순")r.sort((a,b)=>b.id-a.id);
    if(sortBy==="조회수 높은순")r.sort((a,b)=>(b.views||0)-(a.views||0));
    if(sortBy==="7일 증가순")r.sort((a,b)=>(b.views7d||0)-(a.views7d||0));
    return r;
  },[contents,search,pfFilter,stFilter,sortBy]);

  const campRank=useMemo(()=>{
    const m={};
    contents.forEach(c=>{const k=c.campaign||"미분류";if(!m[k])m[k]={name:k,views:0,growth:0,count:0};m[k].views+=c.views||0;m[k].growth+=c.views7d||0;m[k].count++;});
    return Object.values(m).sort((a,b)=>b.views-a.views).slice(0,10);
  },[contents]);
  const maxViews=campRank[0]?.views||1;
  const growthRank=[...campRank].sort((a,b)=>b.growth-a.growth);

  if(contents.length===0)return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>콘텐츠 목록</h1>
      <div style={{...C.card,textAlign:"center",padding:"80px 24px",marginTop:24}}>
        <div style={{fontSize:60,marginBottom:18}}>📭</div>
        <div style={{fontSize:20,fontWeight:700,marginBottom:10}}>등록된 콘텐츠가 없습니다</div>
        <button style={C.btnRed} onClick={onOpenRegister}>+ 첫 콘텐츠 등록하기</button>
      </div>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>콘텐츠 목록</h1>
          <p style={{margin:0,fontSize:13,color:"#6B7280"}}>{filtered.length}건 표시 중</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button style={C.btnOutline}>↓ CSV</button>
          <button style={C.btnOutline}>↻ 전체 지표 업데이트</button>
          <button style={C.btnRed} onClick={onOpenRegister}>+ 콘텐츠 등록</button>
        </div>
      </div>
      <div style={{...C.card,marginBottom:20,padding:16}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
          <input style={{...C.inp,marginBottom:0}} placeholder="콘텐츠 검색..." value={search} onChange={e=>setSearch(e.target.value)}/>
          {["전체","YouTube","Instagram Post","Instagram Reel","Threads"].map(p=>(
            <button key={p} onClick={()=>setPfFilter(p)} style={{padding:"9px 10px",border:"1px solid "+(pfFilter===p?RED:"#E5E7EB"),borderRadius:8,background:pfFilter===p?RED_LIGHT:"#fff",color:pfFilter===p?RED:"#374151",fontSize:12,fontWeight:pfFilter===p?700:400,cursor:"pointer"}}>
              {p==="전체"?"전체 플랫폼":p}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          {["전체","성공","접근 제한","실패"].map(s=>(
            <button key={s} onClick={()=>setStFilter(s)} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+(stFilter===s?RED:"#E5E7EB"),background:stFilter===s?RED_LIGHT:"#fff",color:stFilter===s?RED:"#6B7280",fontSize:13,fontWeight:stFilter===s?700:400,cursor:"pointer"}}>
              {s==="전체"?"전체 상태":s}
            </button>
          ))}
        </div>
      </div>
      {campRank.length>0&&(
        <div style={{...C.card,marginBottom:20}}>
          <div style={{fontSize:14,fontWeight:700,borderLeft:"3px solid "+RED,paddingLeft:10,marginBottom:16}}>그룹별 성과 순위</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:32}}>
            {[
              {title:"캠페인별 조회수 TOP",data:campRank,color:RED,getW:c=>c.views/maxViews*100,getR:c=>`${fmt(c.views)} (${c.count})`},
              {title:"캠페인별 누적 증가 TOP",data:growthRank,color:"#16A34A",getW:c=>Math.min(c.growth/(growthRank[0]?.growth||1)*100,100),getR:c=>`+${fmt(c.growth)} (${c.count})`},
            ].map(col=>(
              <div key={col.title}>
                <p style={{fontSize:12,color:col.color,fontWeight:700,margin:"0 0 12px"}}>{col.title}</p>
                {col.data.map((c,i)=>(
                  <div key={c.name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{width:18,fontSize:13,color:i<3?RED:"#9CA3AF",fontWeight:700}}>{i+1}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>{c.name}</div>
                      <div style={{height:4,background:"#E5E7EB",borderRadius:2}}><div style={{height:"100%",width:col.getW(c)+"%",background:col.color,borderRadius:2}}/></div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:col.color,flexShrink:0}}>{col.getR(c)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={C.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:14,fontWeight:700}}>콘텐츠 리스트 ({filtered.length}건)</div>
          <select style={{padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:8,fontSize:13}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option>최근 등록순</option><option>조회수 높은순</option><option>7일 증가순</option>
          </select>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{borderBottom:"2px solid "+RED_BORDER,background:RED_LIGHT}}>
                {["콘텐츠","플랫폼","상태","브랜드/캠페인","담당자","참여 지표","증가 추이","업로드일","링크"].map(h=>(
                  <th key={h} style={{padding:"10px 12px",fontSize:12,fontWeight:700,color:RED,textAlign:h==="콘텐츠"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item,idx)=>(
                <tr key={item.id} style={{borderBottom:"1px solid #FCF0F1",background:idx%2?"#FFFAFA":"#fff"}}>
                  <td style={{padding:12,verticalAlign:"middle"}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <Thumb src={item.thumbnail}/>
                      <div style={{minWidth:0}}>
                        <p style={{margin:0,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>{item.title||"(제목 없음)"}</p>
                        <a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#9CA3AF",textDecoration:"none"}}>{item.url?.slice(0,36)}...</a>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}><PlatformBadge p={item.platform}/></td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}><StatusBadge s={item.status}/></td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                    <div style={{fontWeight:600}}>{item.brand||"—"}</div>
                    <div style={{color:"#9CA3AF"}}>{item.campaign||"—"}</div>
                  </td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>{item.manager||"—"}</td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                    <div style={{fontWeight:600}}>조회 {fmtFull(item.views)}</div>
                    <div style={{color:"#9CA3AF"}}>♥ {fmtFull(item.likes)} · 💬 {fmtFull(item.comments)}</div>
                  </td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                    <div style={{color:item.views24h>0?"#16A34A":"#9CA3AF"}}>24h {item.views24h>0?"+"+fmt(item.views24h):"—"}</div>
                    <div style={{color:item.views7d>0?"#16A34A":"#9CA3AF"}}>7일 {item.views7d>0?"+"+fmt(item.views7d):"—"}</div>
                  </td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12,color:"#9CA3AF"}}>{item.uploadDate||"—"}</td>
                  <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}>
                    <a href={item.url} target="_blank" rel="noreferrer" style={{border:"1px solid "+RED_BORDER,borderRadius:6,padding:"4px 9px",fontSize:12,color:RED,textDecoration:"none",fontWeight:600}}>↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 캠페인 분석
// ══════════════════════════════════════════════════════════
function Campaigns({contents}) {
  const campaigns=useMemo(()=>{
    const m={};
    contents.forEach(c=>{const k=c.campaign||"미분류";if(!m[k])m[k]={name:k,items:[]};m[k].items.push(c);});
    return Object.values(m).map(g=>({
      name:g.name,count:g.items.length,
      totalViews:g.items.reduce((s,c)=>s+(c.views||0),0),
      avgViews:Math.round(g.items.reduce((s,c)=>s+(c.views||0),0)/g.items.length),
      growth:g.items.reduce((s,c)=>s+(c.views7d||0),0),
      growth24h:g.items.reduce((s,c)=>s+(c.views24h||0),0),
      yt:g.items.filter(c=>c.platform==="YouTube").length,
      ig:g.items.filter(c=>c.platform?.includes("Instagram")).length,
      th:g.items.filter(c=>c.platform==="Threads").length,
      top:[...g.items].sort((a,b)=>(b.views||0)-(a.views||0))[0],
    })).sort((a,b)=>b.totalViews-a.totalViews);
  },[contents]);

  if(contents.length===0)return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>캠페인별 분석</h1>
      <div style={{...C.card,textAlign:"center",padding:"80px 24px",marginTop:24}}>
        <div style={{fontSize:60,marginBottom:18}}>📢</div>
        <div style={{fontSize:20,fontWeight:700,marginBottom:10}}>캠페인 데이터가 없습니다</div>
        <div style={{fontSize:14,color:"#6B7280"}}>콘텐츠 등록 시 캠페인명을 입력하면 분석이 표시됩니다.</div>
      </div>
    </div>
  );

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>캠페인별 분석</h1>
      <p style={{margin:"0 0 24px",fontSize:13,color:"#6B7280"}}>{campaigns.length}개 그룹</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {campaigns.map(c=>(
          <div key={c.name} style={{...C.card,borderTop:"3px solid "+RED}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:15,fontWeight:800}}>{c.name}</h3>
              <div style={{display:"flex",gap:8}}>
                <button style={C.btnOutline}>↻ 최신화</button>
                <button style={C.btnGhost}>✨ 보고 문안 생성</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {[
                {label:"콘텐츠 수",value:c.count},
                {label:"총 조회수",value:fmtFull(c.totalViews)},
                {label:"평균 조회수",value:fmtFull(c.avgViews)},
                {label:"누적 증가",value:c.growth>0?"+"+fmtFull(c.growth):"—",green:true},
                {label:"24h 증가",value:c.growth24h>0?"+"+fmtFull(c.growth24h):"—",green:true},
                {label:"7일 증가",value:c.growth>0?"+"+fmtFull(c.growth):"—",green:true},
              ].map(s=>(
                <div key={s.label} style={{border:"1px solid "+RED_BORDER,borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>{s.label}</div>
                  <div style={{fontSize:15,fontWeight:800,color:s.green&&s.value!=="—"?"#16A34A":"#111827"}}>{s.value}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,marginBottom:12}}>
              <span style={{padding:"3px 10px",borderRadius:20,background:"#FEE2E2",color:"#991B1B",fontSize:12,fontWeight:700}}>YouTube {c.yt}</span>
              <span style={{padding:"3px 10px",borderRadius:20,background:"#F3E8FF",color:"#7C3AED",fontSize:12,fontWeight:700}}>Instagram {c.ig}</span>
              <span style={{padding:"3px 10px",borderRadius:20,background:"#111827",color:"#fff",fontSize:12,fontWeight:700}}>Threads {c.th}</span>
            </div>
            {c.top&&(
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:RED_LIGHT,borderRadius:8,border:"1px solid "+RED_BORDER}}>
                <Thumb src={c.top.thumbnail}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:RED,fontWeight:700,marginBottom:2}}>최고 성과 콘텐츠</div>
                  <div style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.top.title||c.top.url}</div>
                </div>
                <div style={{fontSize:13,fontWeight:800,flexShrink:0}}>{fmtFull(c.top.views)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 회원 관리
// ══════════════════════════════════════════════════════════
function MemberAdmin({users,setUsers,currentUser}) {
  const [filter,setFilter]=useState("전체");
  if(currentUser.role!=="admin")return<div style={{...C.card,textAlign:"center",padding:60}}><div style={{fontSize:48,marginBottom:16}}>🔒</div><div style={{fontSize:18,fontWeight:700}}>관리자 전용 페이지입니다</div></div>;
  const filtered=filter==="전체"?users:users.filter(u=>u.status===filter);
  const updateStatus=(id,status)=>setUsers(prev=>prev.map(u=>u.id===id?{...u,status}:u));
  const deleteUser=(id)=>{if(id===1)return alert("관리자 계정은 삭제할 수 없습니다.");if(window.confirm("정말 삭제하시겠습니까?"))setUsers(prev=>prev.filter(u=>u.id!==id));};
  const counts={전체:users.length,대기:users.filter(u=>u.status==="대기").length,승인:users.filter(u=>u.status==="승인").length,거절:users.filter(u=>u.status==="거절").length};

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>회원 관리</h1>
      <p style={{margin:"0 0 24px",fontSize:13,color:"#6B7280"}}>가입 신청 승인 및 회원 관리</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[{label:"전체 회원",value:counts.전체,color:"#111827"},{label:"승인 완료",value:counts.승인,color:"#16A34A"},{label:"승인 대기",value:counts.대기,color:"#D97706"},{label:"거절",value:counts.거절,color:RED}].map(s=>(
          <div key={s.label} style={{...C.card,padding:"16px 20px",borderTop:"3px solid "+s.color}}>
            <div style={{fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:6}}>{s.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {["전체","대기","승인","거절"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{padding:"7px 18px",borderRadius:8,border:"1px solid "+(filter===f?RED:"#E5E7EB"),background:filter===f?RED:"#fff",color:filter===f?"#fff":"#374151",fontSize:13,fontWeight:filter===f?700:400,cursor:"pointer"}}>
            {f} ({counts[f]})
          </button>
        ))}
      </div>
      <div style={C.card}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{borderBottom:"2px solid "+RED_BORDER,background:RED_LIGHT}}>
              {["이름","이메일","역할","상태","가입일","관리"].map(h=>(
                <th key={h} style={{padding:"12px 16px",fontSize:12,fontWeight:700,color:RED,textAlign:h==="이름"||h==="이메일"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0?(
              <tr><td colSpan={6} style={{padding:"40px",textAlign:"center",color:"#9CA3AF"}}>해당 상태의 회원이 없습니다</td></tr>
            ):filtered.map((u,idx)=>(
              <tr key={u.id} style={{borderBottom:"1px solid #FCF0F1",background:idx%2?"#FFFAFA":"#fff"}}>
                <td style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:u.role==="admin"?RED:"#E5E7EB",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:u.role==="admin"?"#fff":"#374151",flexShrink:0}}>{u.name[0]}</div>
                    <div>
                      <div style={{fontWeight:700}}>{u.name}</div>
                      {u.role==="admin"&&<div style={{fontSize:10,color:RED,fontWeight:700}}>ADMIN</div>}
                    </div>
                  </div>
                </td>
                <td style={{padding:"14px 16px"}}>{u.email}</td>
                <td style={{padding:"14px 16px",textAlign:"center"}}>
                  <span style={{padding:"3px 10px",borderRadius:20,background:u.role==="admin"?RED_LIGHT:"#F3F4F6",color:u.role==="admin"?RED:"#374151",fontSize:12,fontWeight:700}}>{u.role==="admin"?"관리자":"일반 회원"}</span>
                </td>
                <td style={{padding:"14px 16px",textAlign:"center"}}>
                  <span style={{padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:700,background:u.status==="승인"?"#DCFCE7":u.status==="대기"?"#FEF9C3":"#FEE2E2",color:u.status==="승인"?"#166534":u.status==="대기"?"#92400E":"#991B1B"}}>{u.status}</span>
                </td>
                <td style={{padding:"14px 16px",textAlign:"center",color:"#9CA3AF"}}>{u.joinedAt}</td>
                <td style={{padding:"14px 16px",textAlign:"center"}}>
                  {u.role==="admin"?<span style={{fontSize:12,color:"#9CA3AF"}}>—</span>:(
                    <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                      {u.status!=="승인"&&<button onClick={()=>updateStatus(u.id,"승인")} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #BBF7D0",background:"#DCFCE7",color:"#166534",fontSize:12,fontWeight:700,cursor:"pointer"}}>✓ 승인</button>}
                      {u.status!=="거절"&&<button onClick={()=>updateStatus(u.id,"거절")} style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+RED_BORDER,background:RED_LIGHT,color:RED,fontSize:12,fontWeight:700,cursor:"pointer"}}>✕ 거절</button>}
                      <button onClick={()=>deleteUser(u.id)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #E5E7EB",background:"#fff",color:"#9CA3AF",fontSize:12,cursor:"pointer"}}>삭제</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 메인 앱
// ══════════════════════════════════════════════════════════
export default function App() {
  const [users,setUsers]=useState(INIT_USERS);
  const [currentUser,setCurrentUser]=useState(null);
  const [page,setPage]=useState("dashboard");
  const [showRegister,setShowRegister]=useState(false);
  const [contents,setContents]=useState([]);
  const [ytApiKey,setYtApiKey]=useState("");
  const [apifyToken,setApifyToken]=useState("");

  const isAdmin=currentUser?.role==="admin";
  const nav=[
    {key:"dashboard",label:"대시보드"},
    {key:"contents",label:"콘텐츠"},
    {key:"campaigns",label:"캠페인"},
    ...(isAdmin?[{key:"members",label:"👥 회원 관리"},{key:"settings",label:"⚙️ 설정"}]:[]),
  ];

  if(!currentUser)return<AuthScreen users={users} setUsers={setUsers} onLogin={u=>{setCurrentUser(u);setPage("dashboard");}}/>;

  const apiStatus=()=>{
    const yt=!!ytApiKey; const ig=!!apifyToken;
    if(yt&&ig)return{color:"#16A34A",label:"YouTube · Instagram 연결됨",dot:"#16A34A"};
    if(yt)return{color:"#D97706",label:"YouTube만 연결됨",dot:"#D97706"};
    if(ig)return{color:"#D97706",label:"Instagram만 연결됨",dot:"#D97706"};
    return null;
  };
  const status=isAdmin?apiStatus():null;

  return(
    <div style={{minHeight:"100vh",background:"#FDF8F8",fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
      <style>{`*{box-sizing:border-box;}button{transition:all 0.15s;font-family:inherit;}button:hover{opacity:0.82;}@keyframes spin{to{transform:rotate(360deg);}}input:focus,textarea:focus,select:focus{outline:none;border-color:${RED}!important;box-shadow:0 0 0 3px rgba(192,0,26,0.1);}`}</style>

      <nav style={{background:"#fff",borderBottom:"2px solid "+RED_BORDER,position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 8px rgba(192,0,26,0.07)"}}>
        <div style={{maxWidth:1300,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",height:58,gap:4,overflowX:"auto",whiteSpace:"nowrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginRight:16,flexShrink:0}}>
            <div style={{width:34,height:34,background:RED,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontSize:17}}>📊</span>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:800,color:"#111827",lineHeight:1.2}}>SNS 콘텐츠</div>
              <div style={{fontSize:10,color:"#9CA3AF"}}>성과 모니터링</div>
            </div>
          </div>

          {nav.map(item=>(
            <button key={item.key}
              style={{padding:"7px 12px",borderRadius:8,border:"none",background:page===item.key?RED:"transparent",color:page===item.key?"#fff":"#374151",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}
              onClick={()=>setPage(item.key)}>
              {item.label}
            </button>
          ))}

          <div style={{flex:1}}/>

          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
            {/* API 상태 (관리자만) */}
            {isAdmin&&(status?(
              <span style={{fontSize:12,color:status.color,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:status.dot,display:"inline-block"}}/>
                {status.label}
              </span>
            ):(
              <button onClick={()=>setPage("settings")} style={{fontSize:12,color:"#D97706",fontWeight:600,background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>
                ⚠️ API 설정 필요
              </button>
            ))}

            <button style={{display:"flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:8,border:"none",background:RED_DARK,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}
              onClick={()=>setShowRegister(true)}>
              <span style={{fontSize:17,lineHeight:1}}>+</span> 콘텐츠 등록
            </button>

            <div style={{display:"flex",alignItems:"center",gap:10,padding:"7px 16px",border:"1px solid "+RED_BORDER,borderRadius:8,background:RED_LIGHT}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff"}}>{currentUser.name[0]}</div>
              <span style={{fontSize:13,fontWeight:700,color:RED}}>{currentUser.name}</span>
              <span style={{color:RED_BORDER,fontSize:16}}>|</span>
              <button style={{background:"none",border:"none",fontSize:12,color:"#9CA3AF",cursor:"pointer",padding:0,fontFamily:"inherit"}} onClick={()=>{setCurrentUser(null);setPage("dashboard");}}>로그아웃</button>
            </div>
          </div>
        </div>
      </nav>

      <main style={{maxWidth:1300,margin:"0 auto",padding:"28px 24px"}}>
        {page==="dashboard"&&<Dashboard contents={contents} onOpenRegister={()=>setShowRegister(true)}/>}
        {page==="contents"&&<ContentsList contents={contents} onOpenRegister={()=>setShowRegister(true)}/>}
        {page==="campaigns"&&<Campaigns contents={contents}/>}
        {page==="members"&&<MemberAdmin users={users} setUsers={setUsers} currentUser={currentUser}/>}
        {page==="settings"&&<Settings ytApiKey={ytApiKey} setYtApiKey={setYtApiKey} apifyToken={apifyToken} setApifyToken={setApifyToken} currentUser={currentUser}/>}
      </main>

      {showRegister&&<RegisterModal onAdd={item=>setContents(p=>[item,...p])} onClose={()=>setShowRegister(false)} ytApiKey={ytApiKey} apifyToken={apifyToken}/>}
    </div>
  );
}
