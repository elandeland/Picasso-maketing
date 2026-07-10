import { useState, useMemo, useEffect, Fragment } from "react";

// ════════════════════════════════════════════════════════
// Supabase 설정 — 본인 프로젝트 값으로 교체하세요
// ════════════════════════════════════════════════════════
const SUPABASE_URL = "https://kklfzdwxwhzlncvgufag.supabase.co";
const SUPABASE_KEY = "sb_publishable_xAIJqer8wFD_sIhodTtQJg_s9uZXGJx"; // ⚠️ secret key 말고 anon public key를 넣어주세요

const sb = async (table, method="GET", body=null, query="") => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": (method==="POST"||method==="PATCH") ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(()=>"");
    throw new Error(`Supabase 오류 (${res.status}): ${errText}`);
  }
  return method==="DELETE" ? true : res.json();
};

// ── DB 행 ↔ 앱 객체 변환 (snake_case ↔ camelCase)
const contentFromDB = (r) => ({
  id:r.id, url:r.url, platform:r.platform, title:r.title, thumbnail:r.thumbnail,
  campaign:r.campaign, manager:r.manager, uploadDate:r.upload_date, memo:r.memo,
  views:r.views, likes:r.likes, comments:r.comments,
  views24h:r.views_24h, views7d:r.views_7d, status:r.status,
  lastUpdated:r.last_updated, viewsLastWeek:r.views_last_week,
  groupName:r.group_name||"", channel:r.channel||"",
  viewsOffset:r.views_offset||0,
});
const contentToDB = (c) => ({
  id:c.id, url:c.url, platform:c.platform, title:c.title, thumbnail:c.thumbnail,
  campaign:c.campaign, manager:c.manager, upload_date:c.uploadDate, memo:c.memo,
  views:c.views, likes:c.likes, comments:c.comments,
  views_24h:c.views24h, views_7d:c.views7d, status:c.status,
  last_updated:c.lastUpdated, views_last_week:c.viewsLastWeek,
  group_name:c.groupName||"", channel:c.channel||"",
  views_offset:c.viewsOffset||0,
});
const userFromDB = (r) => ({ id:r.id, name:r.name, email:r.email, password:r.password, role:r.role, status:r.status, joinedAt:r.joined_at });

const ytFromDB = (r) => ({
  id:r.id, url:r.url, title:r.title, thumbnail:r.thumbnail,
  campaign:r.campaign, uploadDate:r.upload_date, memo:r.memo,
  views:r.views, likes:r.likes, comments:r.comments,
  views7d:r.views_7d, viewsLastWeek:r.views_last_week,
  lastUpdated:r.last_updated, platform:"YouTube",
});
const ytToDB = (c) => ({
  id:c.id, url:c.url, title:c.title, thumbnail:c.thumbnail,
  campaign:c.campaign, upload_date:c.uploadDate, memo:c.memo,
  views:c.views, likes:c.likes, comments:c.comments,
  views_7d:c.views7d, views_last_week:c.viewsLastWeek,
  last_updated:c.lastUpdated,
});

// ════════════════════════════════════════════════════════
// 컬러 토큰
// ════════════════════════════════════════════════════════
const RED = "#C0001A";
const RED_DARK = "#A0001A";
const RED_LIGHT = "#FFF0F2";
const RED_BORDER = "#F5C2C8";

// ════════════════════════════════════════════════════════
// YouTube API
// ════════════════════════════════════════════════════════
const extractYouTubeId = (url="") => {
  const m1=url.match(/[?&]v=([^&]+)/); if(m1)return m1[1];
  const m2=url.match(/youtu\.be\/([^?&]+)/); if(m2)return m2[1];
  const m3=url.match(/shorts\/([^?&/]+)/); if(m3)return m3[1];
  const m4=url.match(/embed\/([^?&]+)/); if(m4)return m4[1];
  return null;
};
// Edge Function URL (Supabase 프로젝트 URL 기반으로 자동 설정)
const EDGE_FN_URL = SUPABASE_URL.replace("/rest/v1","") + "/functions/v1/clever-function";

// 썸네일을 Supabase Storage에 영구 저장
const uploadThumbnail = async (thumbnailUrl, contentId) => {
  if (!thumbnailUrl) return thumbnailUrl;
  try {
    // 이미 Supabase Storage URL이면 그대로 반환
    if (thumbnailUrl.includes("supabase.co/storage")) return thumbnailUrl;
    // 외부 이미지 fetch
    const imgRes = await fetch(thumbnailUrl);
    if (!imgRes.ok) return thumbnailUrl;
    const blob = await imgRes.blob();
    const ext = blob.type.includes("png") ? "png" : "jpg";
    const filename = `${contentId}.${ext}`;
    // Supabase Storage에 업로드
    const uploadRes = await fetch(
      `${SUPABASE_URL.replace("/rest/v1","")}/storage/v1/object/thumbnails/${filename}`,
      {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": blob.type,
          "x-upsert": "true",
        },
        body: blob,
      }
    );
    if (!uploadRes.ok) return thumbnailUrl;
    // 영구 공개 URL 반환
    return `${SUPABASE_URL.replace("/rest/v1","")}/storage/v1/object/public/thumbnails/${filename}`;
  } catch(e) {
    console.warn("썸네일 업로드 실패:", e.message);
    return thumbnailUrl; // 실패하면 원본 URL 그대로 사용
  }
};

const callEdgeFunction = async (platform, url, apiKeys) => {
  const res = await fetch(EDGE_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      platform,
      url,
      apifyToken: apiKeys.apifyToken,
      ytApiKey: apiKeys.ytApiKey,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Edge Function 오류");
  return data.data;
};

const fetchYouTubeStats = async (url, apiKey) => {
  return await callEdgeFunction("youtube", url, { ytApiKey: apiKey });
};

// ════════════════════════════════════════════════════════
// Apify Instagram (프로필 기반 — 조회수 포함)
// ════════════════════════════════════════════════════════
const fetchInstagramStats = async (url, apifyToken) => {
  return await callEdgeFunction("instagram", url, { apifyToken });
};

// ════════════════════════════════════════════════════════
// 유틸
// ════════════════════════════════════════════════════════
const fmt = (n) => { if(!n)return"0"; if(n>=1000000)return(n/1000000).toFixed(1)+"M"; if(n>=1000)return(n/1000).toFixed(1)+"K"; return n.toLocaleString(); };
const fmtFull = (n) => (n||0).toLocaleString();

// 인스타그램은 좋아요×100을 조회수로 환산해서 합산 + 보정값 추가
const effectiveViews = (item) => {
  const base = item.views||0;
  const offset = item.viewsOffset||0;
  const likeBonus = item.platform?.includes("Instagram") ? (item.likes||0)*100 : 0;
  return base + offset + likeBonus;
};
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

// ════════════════════════════════════════════════════════
// 공통 스타일
// ════════════════════════════════════════════════════════
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
const FullPageLoader = ({msg}) => (
  <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,background:"#FDF8F8"}}>
    <Spinner size={32}/>
    <div style={{fontSize:14,color:"#6B7280"}}>{msg}</div>
  </div>
);

// ════════════════════════════════════════════════════════
// 로그인 / 회원가입 (DB 연동)
// ════════════════════════════════════════════════════════
function AuthScreen({onLogin}) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({name:"",email:"",password:"",passwordConfirm:""});
  const [err,setErr]=useState("");
  const [success,setSuccess]=useState("");
  const [loading,setLoading]=useState(false);
  const set=(k,v)=>{setForm(f=>({...f,[k]:v}));setErr("");};

  const handleLogin=async()=>{
    if(!form.email||!form.password)return setErr("이메일과 비밀번호를 입력해주세요.");
    setLoading(true);setErr("");
    try{
      const rows = await sb("users","GET",null,`?email=eq.${encodeURIComponent(form.email)}`);
      const found = rows?.[0];
      if(!found||found.password!==form.password) return setErr("이메일 또는 비밀번호가 올바르지 않습니다.");
      if(found.status==="대기") return setErr("관리자 승인 대기 중입니다.");
      if(found.status==="거절") return setErr("접근이 거절된 계정입니다.");
      onLogin(userFromDB(found));
    }catch(e){ setErr("로그인 중 오류: "+e.message); }
    finally{ setLoading(false); }
  };

  const handleSignup=async()=>{
    if(!form.name.trim())return setErr("이름을 입력해주세요.");
    if(!form.email.includes("@"))return setErr("올바른 이메일을 입력해주세요.");
    if(!form.password||form.password.length<4)return setErr("비밀번호는 4자 이상 입력해주세요.");
    if(form.password!==form.passwordConfirm)return setErr("비밀번호가 일치하지 않습니다.");
    setLoading(true);setErr("");
    try{
      const exists = await sb("users","GET",null,`?email=eq.${encodeURIComponent(form.email)}`);
      if(exists?.length) return setErr("이미 가입된 이메일입니다.");
      await sb("users","POST",{
        id: Date.now(), name: form.name.trim(), email: form.email.trim(),
        password: form.password, role: "member", status: "대기",
        joined_at: new Date().toISOString().slice(0,10),
      });
      setSuccess("가입 신청 완료! 관리자 승인 후 로그인 가능합니다.");
      setForm({name:"",email:"",password:"",passwordConfirm:""});
    }catch(e){ setErr("가입 중 오류: "+e.message); }
    finally{ setLoading(false); }
  };

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${RED} 0%,#7B000F 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{`*{box-sizing:border-box;}@keyframes spin{to{transform:rotate(360deg);}}input:focus{outline:none;border-color:${RED}!important;box-shadow:0 0 0 3px rgba(192,0,26,0.15);}`}</style>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:60,height:60,background:"rgba(255,255,255,0.15)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",border:"1px solid rgba(255,255,255,0.3)"}}>
            <span style={{fontSize:28}}>📊</span>
          </div>
          <div style={{fontSize:20,fontWeight:900,color:"#fff"}}>피카소 조회수 모니터링</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginTop:4}}>피카소 TF 대시보드</div>
        </div>
        <div style={{background:"#fff",borderRadius:20,padding:"32px 36px",boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}}>
          <div style={{display:"flex",background:"#F3F4F6",borderRadius:10,padding:4,marginBottom:28}}>
            {[{key:"login",label:"로그인"},{key:"signup",label:"회원가입"}].map(t=>(
              <button key={t.key} onClick={()=>{setMode(t.key);setErr("");setSuccess("");setForm({name:"",email:"",password:"",passwordConfirm:""}); }}
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
              <button style={{...C.btnRed,width:"100%",padding:"12px 0",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:loading?0.7:1}} onClick={handleLogin} disabled={loading}>
                {loading&&<Spinner size={14}/>}{loading?"로그인 중...":"로그인"}
              </button>
            </>
          ):(
            <>
              <label style={C.lbl}>이름 *</label>
              <input style={C.inp} type="text" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="실명을 입력하세요"/>
              <label style={C.lbl}>이메일 *</label>
              <input style={C.inp} type="email" value={form.email} onChange={e=>set("email",e.target.value)} placeholder="이메일을 입력하세요"/>
              <label style={C.lbl}>비밀번호 *</label>
              <input style={C.inp} type="password" value={form.password} onChange={e=>set("password",e.target.value)} placeholder="4자 이상 입력하세요"/>
              <label style={C.lbl}>비밀번호 확인 *</label>
              <input style={C.inp} type="password" value={form.passwordConfirm} onChange={e=>set("passwordConfirm",e.target.value)} placeholder="비밀번호를 다시 입력하세요" onKeyDown={e=>e.key==="Enter"&&handleSignup()}/>
              <p style={{fontSize:12,color:"#9CA3AF",margin:"0 0 20px",lineHeight:1.5}}>가입 신청 후 관리자 승인이 완료되면 로그인할 수 있습니다.</p>
              <button style={{...C.btnRed,width:"100%",padding:"12px 0",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:loading?0.7:1}} onClick={handleSignup} disabled={loading}>
                {loading&&<Spinner size={14}/>}{loading?"신청 중...":"가입 신청"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 설정 페이지 (DB 연동)
// ════════════════════════════════════════════════════════
function Settings({settings,refreshSettings,currentUser,monthlyGoals,refreshGoals}) {
  const [ytInput,setYtInput]=useState(settings.ytApiKey||"");
  const [igInput,setIgInput]=useState(settings.apifyToken||"");
  const [ytTesting,setYtTesting]=useState(false);
  const [igTesting,setIgTesting]=useState(false);
  const [ytResult,setYtResult]=useState(null);
  const [igResult,setIgResult]=useState(null);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState("");

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const [goalInput,setGoalInput]=useState(monthlyGoals[thisMonthKey]||"");
  const [goalSaving,setGoalSaving]=useState(false);
  const [goalSaved,setGoalSaved]=useState("");

  if(currentUser.role!=="admin") return(
    <div style={{...C.card,textAlign:"center",padding:60}}>
      <div style={{fontSize:48,marginBottom:16}}>🔒</div>
      <div style={{fontSize:18,fontWeight:700}}>관리자 전용 페이지입니다</div>
    </div>
  );

  const saveGoal = async () => {
    const goalNum = parseInt(goalInput) || 0;
    setGoalSaving(true);
    try {
      // upsert: 있으면 갱신, 없으면 생성
      const existing = await sb("monthly_goals","GET",null,`?month=eq.${thisMonthKey}`);
      if (existing?.length) {
        await sb("monthly_goals","PATCH",{goal:goalNum},`?month=eq.${thisMonthKey}`);
      } else {
        await sb("monthly_goals","POST",{month:thisMonthKey, goal:goalNum});
      }
      await refreshGoals();
      setGoalSaved("✅ "+(now.getMonth()+1)+"월 목표가 저장되었습니다.");
      setTimeout(()=>setGoalSaved(""),3000);
    } catch(e) {
      setGoalSaved("❌ 저장 실패: "+e.message);
    } finally {
      setGoalSaving(false);
    }
  };

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
      const res=await fetch(`https://api.apify.com/v2/users/me?token=${igInput.trim()}`);
      const data=await res.json();
      if(data.error||!data.data?.username)throw new Error(data.error?.message||"토큰이 유효하지 않습니다.");
      setIgResult({ok:true,msg:`✅ Apify 연결 성공! (계정: ${data.data.username})`});
    }catch(e){setIgResult({ok:false,msg:"❌ "+e.message});}
    finally{setIgTesting(false);}
  };

  const saveAll=async()=>{
    setSaving(true);
    try{
      await sb("app_settings","PATCH",{ yt_api_key:ytInput.trim(), apify_token:igInput.trim() },"?id=eq.1");
      await refreshSettings();
      setSaved("✅ 저장 완료! 이제 어떤 기기에서든 로그인하면 동일하게 적용됩니다.");
      setTimeout(()=>setSaved(""),4000);
    }catch(e){ setSaved("❌ 저장 실패: "+e.message); }
    finally{ setSaving(false); }
  };

  const maskKey=(k)=>k?k.slice(0,8)+"••••••••••••••••"+k.slice(-4):"";

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
      {inputVal&&(
        <div style={{padding:"8px 12px",background:RED_LIGHT,border:"1px solid "+RED_BORDER,borderRadius:8,marginBottom:10,fontSize:12,fontFamily:"monospace",color:"#6B7280"}}>
          현재 저장된 값: {maskKey(inputVal)}
        </div>
      )}
      <label style={C.lbl}>토큰 / API 키 (새 값으로 교체 시 입력)</label>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <input style={{...C.inp,marginBottom:0,flex:1,fontFamily:"monospace"}} type="password" value={inputVal} onChange={e=>setInputVal(e.target.value)} placeholder={`${title} 키 입력...`}/>
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
      <p style={{margin:"0 0 28px",fontSize:13,color:"#6B7280"}}>API 키 및 연동 설정 (DB에 저장되어 모든 기기에서 공유됩니다)</p>

      {saved&&<div style={{padding:"12px 16px",borderRadius:10,marginBottom:20,fontSize:14,fontWeight:600,background:saved.includes("실패")?"#FEE2E2":"#DCFCE7",color:saved.includes("실패")?"#991B1B":"#166534"}}>{saved}</div>}

      {/* 이번달 목표 설정 */}
      <div style={{...C.card,maxWidth:680,marginBottom:20,borderTop:"3px solid "+RED}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:36,height:36,background:RED,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🎯</div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:"#111827"}}>{now.getMonth()+1}월 조회수 목표</div>
            <div style={{fontSize:12,color:"#6B7280"}}>대시보드 달성률 계산에 사용됩니다</div>
          </div>
        </div>
        {goalSaved&&<div style={{padding:"10px 14px",borderRadius:8,marginBottom:12,fontSize:13,fontWeight:600,background:goalSaved.includes("실패")?"#FEE2E2":"#DCFCE7",color:goalSaved.includes("실패")?"#991B1B":"#166534"}}>{goalSaved}</div>}
        <label style={C.lbl}>목표 조회수</label>
        <div style={{display:"flex",gap:8}}>
          <input style={{...C.inp,marginBottom:0,flex:1}} type="number" value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="예: 100000000"/>
          <button style={{...C.btnRed,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}} onClick={saveGoal} disabled={goalSaving}>
            {goalSaving&&<Spinner size={13}/>}{goalSaving?"저장 중...":"목표 저장"}
          </button>
        </div>
      </div>

      <ApiCard title="YouTube Data API v3" subtitle="조회수·좋아요·댓글 자동 수집" color="#FF0000" icon="▶️"
        inputVal={ytInput} setInputVal={setYtInput} onTest={testYT} testing={ytTesting} result={ytResult}
        link="https://console.cloud.google.com/apis/library/youtube.googleapis.com" linkLabel="Google Cloud Console">
        <div style={{padding:"12px 16px",background:"#F9FAFB",borderRadius:8,marginBottom:16,fontSize:12,color:"#6B7280",lineHeight:1.8}}>
          📋 <b>무료 할당량:</b> 하루 10,000 쿼리 · 영상 1개 = 쿼리 1개
        </div>
      </ApiCard>

      <ApiCard title="Instagram 스크래퍼 (Apify)" subtitle="공개 계정 게시물 좋아요·댓글·조회수 수집" color="#E1306C" icon="📸"
        inputVal={igInput} setInputVal={setIgInput} onTest={testIG} testing={igTesting} result={igResult}
        link="https://console.apify.com/account/integrations" linkLabel="Apify 토큰 발급">
        <div style={{padding:"12px 16px",background:"#FFF0F5",border:"1px solid #FFC8D8",borderRadius:8,marginBottom:16,fontSize:12,color:"#9B1B40",lineHeight:1.8}}>
          ⚠️ 공개 계정만 가능 · 릴스 조회수는 프로필 기반 스크래핑으로 수집 (최근 게시물 50개 내)
        </div>
      </ApiCard>

      <div style={{marginTop:24,maxWidth:680,display:"flex",justifyContent:"flex-end"}}>
        <button style={{...C.btnRed,padding:"11px 32px",fontSize:15,display:"flex",alignItems:"center",gap:8,opacity:saving?0.7:1}} onClick={saveAll} disabled={saving}>
          {saving&&<Spinner size={14}/>}{saving?"저장 중...":"전체 저장"}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 콘텐츠 등록 모달
// ════════════════════════════════════════════════════════
function RegisterModal({onAdd,onUpdate,onClose,ytApiKey,apifyToken,editItem,allContents}) {
  const isEditMode = !!editItem;
  const [form,setForm]=useState(()=> editItem ? {
    url:editItem.url||"", title:editItem.title||"", campaign:editItem.campaign||"",
    manager:editItem.manager||"", uploadDate:editItem.uploadDate||"", memo:editItem.memo||"",
    manualViews:editItem.views||"", manualLikes:editItem.likes||"", manualComments:editItem.comments||"",
    groupName:editItem.groupName||"", channel:editItem.channel||"",
    viewsOffset:editItem.viewsOffset||0,
  } : {url:"",title:"",campaign:"",manager:"",uploadDate:"",memo:"",manualViews:"",manualLikes:"",manualComments:"",groupName:"",channel:"",viewsOffset:0});
  const [showGroupSuggestions,setShowGroupSuggestions]=useState(false);

  // 기존 그룹명 목록 (중복 제거)
  const existingGroups=[...new Set((allContents||[]).map(c=>c.groupName).filter(Boolean))];
  const filteredGroups=existingGroups.filter(g=>g.toLowerCase().includes((form.groupName||"").toLowerCase())&&g!==form.groupName);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
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
      if(s.channel)set("channel",s.channel);
    }catch(e){setFetchErr(e.message);}
    finally{setLoading(false);}
  };

  const handleSave=async(autoFetch)=>{
    if(!form.url.trim())return alert("URL을 입력해주세요.");
    setSaving(true);
    let s=preview;
    if(autoFetch&&canAutoFetch&&!s){
      try{
        if(isYT)s=await fetchYouTubeStats(form.url,ytApiKey);
        else if(isIG)s=await fetchInstagramStats(form.url,apifyToken);
      }catch(e){setFetchErr(e.message);setSaving(false);return;}
    }
    const contentId = isEditMode ? editItem.id : Date.now();
    // 썸네일 Supabase Storage에 영구 저장
    const rawThumb = s?.thumbnail||editItem?.thumbnail||"";
    const thumbnail = await uploadThumbnail(rawThumb, contentId);

    const itemData={
      url:form.url.trim(),
      platform:detected||"Instagram Post",
      title:s?.title||form.title||"",
      thumbnail,
      campaign:form.campaign,
      manager:form.manager,
      uploadDate:form.uploadDate||s?.publishedAt||new Date().toISOString().slice(0,10),
      memo:form.memo,
      views: isEditMode
        ? (form.manualViews!==""&&form.manualViews!==null ? parseInt(form.manualViews)||0 : editItem.views||0)
        : (s?.views||parseInt(form.manualViews)||0),
      likes: isEditMode
        ? (form.manualLikes!==""&&form.manualLikes!==null ? parseInt(form.manualLikes)||0 : editItem.likes||0)
        : (s?.likes||parseInt(form.manualLikes)||0),
      comments: isEditMode
        ? (form.manualComments!==""&&form.manualComments!==null ? parseInt(form.manualComments)||0 : editItem.comments||0)
        : (s?.comments||parseInt(form.manualComments)||0),
      views24h:editItem?.views24h||0,views7d:editItem?.views7d||0,status:"성공",
      lastUpdated:editItem?.lastUpdated||new Date().toISOString(),
      viewsLastWeek:editItem?.viewsLastWeek ?? (s?.views||parseInt(form.manualViews)||0),
      groupName:form.groupName||"",
      channel:s?.channel||form.channel||"",
      viewsOffset:parseInt(form.viewsOffset)||0,
    };
    try{
      if(isEditMode){
        const updated={...itemData,id:editItem.id};
        await sb("contents","PATCH",contentToDB(updated),`?id=eq.${editItem.id}`);
        // 수동 수정 시 증가분이 있으면 현재 시점으로 이력 기록
        const prevViews = editItem.views||0;
        const newViews = itemData.views||0;
        const manualGrowth = newViews - prevViews;
        if(manualGrowth !== 0){
          try{
            await sb("view_history","POST",{
              id: Date.now()+Math.floor(Math.random()*1000),
              content_id: editItem.id,
              views_at_update: newViews,
              growth: manualGrowth,
              recorded_at: new Date().toISOString(),
            });
          }catch(histErr){ console.warn("수동 수정 이력 기록 실패:", histErr.message); }
        }
        onUpdate(updated);
      }else{
        const newItem={...itemData,id:contentId};
        await sb("contents","POST",contentToDB(newItem));
        // 신규 등록 시 현재 조회수를 해당 월 집계에 반영
        if(newItem.views>0){
          try{
            await sb("view_history","POST",{
              id: Date.now()+Math.floor(Math.random()*1000),
              content_id: newItem.id,
              views_at_update: newItem.views,
              growth: newItem.views,
              recorded_at: new Date().toISOString(),
            });
          }catch(histErr){ console.warn("초기 이력 기록 실패:", histErr.message); }
        }
        onAdd(newItem);
      }
      setSaving(false);onClose();
    }catch(e){
      setFetchErr("저장 실패: "+e.message);
      setSaving(false);
    }
  };

  const PreviewBox=()=>{
    if(loading)return(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px",background:"#fff",borderRadius:8,border:"1px solid "+RED_BORDER,marginTop:10}}>
        <Spinner/><div style={{fontSize:13,color:"#6B7280"}}>{isIG?"Instagram 데이터 수집 중... (최대 90초)":"YouTube 데이터 가져오는 중..."}</div>
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
          {[{label:"조회수",value:preview.views?fmtFull(preview.views):"없음"},{label:"좋아요",value:fmtFull(preview.likes)},{label:"댓글",value:fmtFull(preview.comments)}].map(s=>(
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
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{isEditMode?"콘텐츠 수정":"콘텐츠 등록"}</h2>
            <p style={{margin:"4px 0 0",fontSize:13,color:RED}}>{isEditMode?"내용을 수정하고 저장하세요.":"URL을 붙여넣으면 플랫폼 자동 인식 + 데이터 자동 수집"}</p>
          </div>
          <button style={{background:"none",border:"none",fontSize:22,color:"#9CA3AF",cursor:"pointer"}} onClick={onClose}>✕</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,padding:"24px 28px"}}>
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
                </div>
              )}
              <PreviewBox/>
            </div>

            {(isEditMode||isThreads||fetchErr||(!canAutoFetch&&(isIG||isYT)))&&(
              <div style={{background:"#F9FAFB",borderRadius:12,padding:16,border:"1px solid #E5E7EB"}}>
                <h3 style={{margin:"0 0 12px",fontSize:13,fontWeight:700,color:"#374151"}}>
                  {isEditMode?"✏️ 지표 직접 수정":isThreads?"🧵 Threads — 수동 입력":"📝 수동 지표 입력"}
                </h3>
                {isEditMode&&<p style={{margin:"0 0 10px",fontSize:11,color:"#9CA3AF"}}>자동으로 가져온 값이 실제와 다를 경우 직접 수정해주세요.</p>}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[{key:"manualViews",label:"조회수"},{key:"manualLikes",label:"좋아요"},{key:"manualComments",label:"댓글"}].map(f=>(
                    <div key={f.key}>
                      <label style={{...C.lbl,fontSize:11}}>{f.label}</label>
                      <input style={{...C.inp,marginBottom:0,fontSize:13,padding:"8px 10px"}} type="number" value={form[f.key]} onChange={e=>set(f.key,e.target.value)} placeholder="0"/>
                    </div>
                  ))}
                </div>
                {isEditMode&&(
                  <div style={{marginTop:12,padding:"12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8}}>
                    <label style={{...C.lbl,fontSize:11,color:"#92400E"}}>📐 보정값 (실제값 - 자동수집값)</label>
                    <input style={{...C.inp,marginBottom:0,fontSize:13,padding:"8px 10px"}} type="number" value={form.viewsOffset} onChange={e=>set("viewsOffset",e.target.value)} placeholder="예: 61444 (실제 89000 - 자동 27556)"/>
                    {form.viewsOffset>0&&<div style={{fontSize:11,color:"#92400E",marginTop:6}}>
                      최종 표시 조회수: {((parseInt(form.manualViews)||0) + (parseInt(form.viewsOffset)||0)).toLocaleString()}
                    </div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 style={{margin:"0 0 14px",fontSize:14,fontWeight:700}}>콘텐츠 정보</h3>
            <label style={C.lbl}>콘텐츠명</label>
            <input style={C.inp} value={form.title} onChange={e=>set("title",e.target.value)} placeholder="(YouTube·Instagram은 자동 입력)"/>
            <label style={C.lbl}>그룹명 <span style={{fontWeight:400,color:"#9CA3AF"}}>(선택 — 같은 이름끼리 합산 표시)</span></label>
            <div style={{position:"relative",marginBottom:12}}>
              <input style={{...C.inp,marginBottom:0}} value={form.groupName}
                onChange={e=>{set("groupName",e.target.value);setShowGroupSuggestions(true);}}
                onFocus={()=>setShowGroupSuggestions(true)}
                onBlur={()=>setTimeout(()=>setShowGroupSuggestions(false),200)}
                placeholder="예: 피카소 도예전 메인영상"/>
              {showGroupSuggestions&&filteredGroups.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,boxShadow:"0 4px 12px rgba(0,0,0,0.1)",zIndex:100,maxHeight:160,overflowY:"auto"}}>
                  {filteredGroups.map(g=>(
                    <div key={g} style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"#374151"}}
                      onMouseDown={()=>{set("groupName",g);setShowGroupSuggestions(false);}}>
                      🔗 {g}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><label style={C.lbl}>캠페인</label><input style={C.inp} value={form.campaign} onChange={e=>set("campaign",e.target.value)}/></div>
              <div><label style={C.lbl}>담당자</label><input style={C.inp} value={form.manager} onChange={e=>set("manager",e.target.value)}/></div>
              <div><label style={C.lbl}>채널명 <span style={{fontWeight:400,color:"#9CA3AF"}}>(자동 입력)</span></label><input style={{...C.inp,background:"#F9FAFB",color:form.channel?"#111827":"#9CA3AF"}} value={form.channel||""} readOnly placeholder="URL 입력 시 자동으로 채워집니다"/></div>
            </div>
            <label style={C.lbl}>업로드일</label>
            <input style={C.inp} type="date" value={form.uploadDate} onChange={e=>set("uploadDate",e.target.value)}/>
            <label style={C.lbl}>메모</label>
            <textarea style={{...C.inp,height:80,resize:"vertical"}} value={form.memo} onChange={e=>set("memo",e.target.value)}/>
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:10,padding:"0 28px 24px"}}>
          <button style={C.btnOutline} onClick={onClose}>취소</button>
          {!isEditMode&&<button style={C.btnOutline} onClick={()=>handleSave(false)} disabled={saving}>저장만 하기</button>}
          <button style={{...C.btnRed,opacity:saving?0.6:1,display:"flex",alignItems:"center",gap:8}} onClick={()=>handleSave(!isEditMode)} disabled={saving}>
            {saving&&<Spinner size={14}/>}
            {saving?"저장 중...":isEditMode?"수정 사항 저장":"저장 + 최초 지표 가져오기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 대시보드
// ════════════════════════════════════════════════════════
function Dashboard({contents,viewHistory,monthlyGoals,onOpenRegister}) {
  const total=contents.length;
  const totalViews=contents.reduce((s,c)=>s+effectiveViews(c),0);
  const week=contents.reduce((s,c)=>s+(c.views7d||0),0);
  const topView=[...contents].sort((a,b)=>effectiveViews(b)-effectiveViews(a))[0];
  const topGrowth=[...contents].sort((a,b)=>(b.views7d||0)-(a.views7d||0))[0];
  const top24h=[...contents].sort((a,b)=>(b.views24h||0)-(a.views24h||0)).filter(i=>i.views24h>0).slice(0,10);
  const top7d=[...contents].sort((a,b)=>(b.views7d||0)-(a.views7d||0)).filter(i=>i.views7d>0).slice(0,10);

  // 이번 주 월요일 기준
  const now = new Date();
  const todayMidnight = new Date(now); todayMidnight.setHours(0,0,0,0);
  const dayOfWeekNow = (todayMidnight.getDay()+6)%7;
  const thisMonday = new Date(todayMidnight); thisMonday.setDate(todayMidnight.getDate()-dayOfWeekNow);

  // 이번 주 신규 등록 콘텐츠 조회수 합계
  const newContentsThisWeek = contents.filter(c => {
    if(!c.uploadDate) return false;
    const d = new Date(c.uploadDate);
    return d >= thisMonday;
  });
  const newContentsViews = newContentsThisWeek.reduce((s,c)=>s+effectiveViews(c),0);

  // 기존 콘텐츠 이번 주 증가분 (view_history 기준)
  const nextMonday = new Date(thisMonday); nextMonday.setDate(thisMonday.getDate()+7);
  const existingGrowthThisWeek = viewHistory
    .filter(h=>{
      const d=new Date(h.recordedAt);
      return d>=thisMonday && d<nextMonday;
    })
    .filter(h=>{
      // 신규 등록 콘텐츠 제외 (이번 주 uploadDate인 콘텐츠)
      const content = contents.find(c=>c.id===h.contentId);
      if(!content||!content.uploadDate) return true;
      return new Date(content.uploadDate) < thisMonday;
    })
    .reduce((s,h)=>s+(h.growth||0),0);
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth()+1).padStart(2,"0")}`;

  const sumGrowthForMonth = (monthKey) => {
    return viewHistory
      .filter(h => h.recordedAt && h.recordedAt.slice(0,7) === monthKey)
      .reduce((s,h) => s + (h.growth||0), 0);
  };

  const thisMonthViews = sumGrowthForMonth(thisMonthKey);
  const lastMonthViews = sumGrowthForMonth(lastMonthKey);
  const monthGoal = monthlyGoals[thisMonthKey] || 0;
  const achieveRate = monthGoal>0 ? Math.round(thisMonthViews/monthGoal*100) : null;
  const momGrowthRate = lastMonthViews>0 ? Math.round((thisMonthViews-lastMonthViews)/lastMonthViews*100) : null;

  // ── 주차별 추이 (최근 8주, 월요일 시작 기준)
  const weeklySeries = useMemo(()=>{
    const weeks = [];
    const today0 = new Date(); today0.setHours(0,0,0,0);
    const dayOfWeek = (today0.getDay()+6)%7; // 월=0
    const thisMonday = new Date(today0); thisMonday.setDate(today0.getDate()-dayOfWeek);
    for (let i=7;i>=0;i--) {
      const start = new Date(thisMonday); start.setDate(thisMonday.getDate()-7*i);
      const end = new Date(start); end.setDate(start.getDate()+7);
      const sum = viewHistory
        .filter(h=>{ const d=new Date(h.recordedAt); return d>=start && d<end; })
        .reduce((s,h)=>s+(h.growth||0),0);
      weeks.push({ label:`${start.getMonth()+1}/${start.getDate()}`, value: sum });
    }
    return weeks;
  },[viewHistory]);

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

      {/* 월별 성과 카드 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <div style={{...C.card,padding:"18px 20px",borderTop:"3px solid "+RED}}>
          <div style={{fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:6}}>{now.getMonth()+1}월 조회수</div>
          <div style={{fontSize:26,fontWeight:800,color:"#111827"}}>{fmtFull(thisMonthViews)}</div>
          <div style={{fontSize:11,color:"#9CA3AF",marginTop:4}}>이번달 누적 증가분</div>
        </div>
        <div style={{...C.card,padding:"18px 20px",borderTop:"3px solid "+RED}}>
          <div style={{fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:6}}>{now.getMonth()+1}월 목표</div>
          <div style={{fontSize:26,fontWeight:800,color:"#111827"}}>{monthGoal>0?fmtFull(monthGoal):"미설정"}</div>
          <div style={{fontSize:11,marginTop:4,fontWeight:700,color:achieveRate==null?"#9CA3AF":achieveRate>=100?"#16A34A":"#D97706"}}>
            {achieveRate==null?"설정 페이지에서 목표 입력":`달성률 ${achieveRate}%`}
          </div>
        </div>
        <div style={{...C.card,padding:"18px 20px",borderTop:"3px solid "+RED}}>
          <div style={{fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:6}}>{lastMonthDate.getMonth()+1}월 조회수 (저번달)</div>
          <div style={{fontSize:26,fontWeight:800,color:"#111827"}}>{fmtFull(lastMonthViews)}</div>
          <div style={{fontSize:11,marginTop:4,fontWeight:700,color:momGrowthRate==null?"#9CA3AF":momGrowthRate>=0?"#16A34A":RED}}>
            {momGrowthRate==null?"비교 데이터 없음":`전월 대비 ${momGrowthRate>=0?"+":""}${momGrowthRate}%`}
          </div>
        </div>
        <div style={{...C.card,padding:"18px 20px",borderTop:"3px solid "+RED}}>
          <div style={{fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:6}}>누적 조회수</div>
          <div style={{fontSize:26,fontWeight:800,color:"#111827"}}>{fmtFull(totalViews)}</div>
          <div style={{fontSize:11,color:"#9CA3AF",marginTop:4}}>전체 플랫폼 합계</div>
        </div>
      </div>

      {/* 주차별 추이 그래프 */}
      <div style={{...C.card,marginBottom:24}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,borderLeft:"3px solid "+RED,paddingLeft:10}}>주차별 조회수 추이 (최근 8주)</div>
        <WeeklyLineChart data={weeklySeries}/>
      </div>

      {/* 24h / 7일 증가 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:24}}>
        {[
          {label:"이번 주 신규 콘텐츠",value:newContentsViews>0?fmt(newContentsViews):"—",icon:"🆕",sub:`${newContentsThisWeek.length}건 등록`},
          {label:"이번 주 기존 콘텐츠 증가",value:existingGrowthThisWeek>0?"+"+fmt(existingGrowthThisWeek):"—",icon:"📈",green:true},
        ].map(s=>(
          <div key={s.label} style={{...C.card,padding:"16px 18px",borderTop:"3px solid "+RED}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#6B7280",fontWeight:600}}>{s.label}</span><span style={{fontSize:15}}>{s.icon}</span></div>
            <div style={{fontSize:26,fontWeight:800,color:week>0?"#16A34A":"#111827",marginTop:6}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
        {[
          {title:"최고 조회수 콘텐츠",item:topView,sub:v=>fmtFull(effectiveViews(v))+" 회",color:"#111827"},
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
        {/* 누적 조회수 Top 10 (순위 변동 포함) */}
        <div style={C.card}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:14,borderLeft:"3px solid "+RED,paddingLeft:10}}>누적 조회수 Top 10</div>
          {(()=>{
            const topAll=[...contents].sort((a,b)=>effectiveViews(b)-effectiveViews(a)).slice(0,10);
            // localStorage에서 지난주 순위 불러오기
            let lastRanks={};
            try{ lastRanks=JSON.parse(localStorage.getItem("sns_last_ranks")||"{}"); }catch(e){}
            // 매주 월요일에 순위 갱신
            const lastSaved=localStorage.getItem("sns_ranks_saved_at");
            const shouldSave=!lastSaved||new Date(lastSaved)<thisMonday;
            if(shouldSave&&topAll.length>0){
              const newRanks={};
              topAll.forEach((item,i)=>{ newRanks[item.id]=i+1; });
              try{
                localStorage.setItem("sns_last_ranks",JSON.stringify(newRanks));
                localStorage.setItem("sns_ranks_saved_at",thisMonday.toISOString());
              }catch(e){}
            }
            if(topAll.length===0) return <p style={{color:"#9CA3AF",fontSize:13}}>데이터가 없습니다</p>;
            return topAll.map((item,i)=>{
              const lastRank=lastRanks[item.id];
              const rankChange=lastRank?(lastRank-(i+1)):null;
              return(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:28,flexShrink:0,textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:700,color:i<3?RED:"#9CA3AF"}}>{i+1}</div>
                    {rankChange!==null&&(
                      <div style={{fontSize:10,fontWeight:700,color:rankChange>0?"#16A34A":rankChange<0?RED:"#9CA3AF"}}>
                        {rankChange>0?`▲${rankChange}`:rankChange<0?`▼${Math.abs(rankChange)}`:"—"}
                      </div>
                    )}
                  </div>
                  <Thumb src={item.thumbnail}/>
                  <div style={{flex:1,minWidth:0}}>
                    <PlatformBadge p={item.platform}/>
                    <p style={{margin:"3px 0 2px",fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{item.title||item.url}</p>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:"#111827",flexShrink:0}}>{fmt(effectiveViews(item))}</span>
                </div>
              );
            });
          })()}
        </div>
        {/* 최근 7일 급상승 Top 10 */}
        <div style={C.card}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:14,borderLeft:"3px solid "+RED,paddingLeft:10}}>최근 7일 급상승 Top 10</div>
          {top7d.length===0?<p style={{color:"#9CA3AF",fontSize:13}}>집계 데이터가 없습니다</p>
          :top7d.map((item,i)=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <span style={{width:18,fontSize:13,fontWeight:700,color:i<3?RED:"#9CA3AF"}}>{i+1}</span>
              <Thumb src={item.thumbnail}/>
              <div style={{flex:1,minWidth:0}}>
                <PlatformBadge p={item.platform}/>
                <p style={{margin:"3px 0 2px",fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{item.title||item.url}</p>
                <StatusBadge s={item.status}/>
              </div>
              <span style={{fontSize:13,fontWeight:700,color:"#16A34A",flexShrink:0}}>+{fmt(item.views7d)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 단순 SVG 꺾은선 그래프 (외부 라이브러리 없이)
function WeeklyLineChart({data}) {
  if (!data || data.length===0) return <p style={{color:"#9CA3AF",fontSize:13}}>데이터가 없습니다</p>;
  const W=720, H=220, padL=50, padR=20, padT=20, padB=36;
  const maxVal = Math.max(...data.map(d=>d.value), 1);
  const stepX = (W-padL-padR) / (data.length-1 || 1);
  const points = data.map((d,i)=>{
    const x = padL + i*stepX;
    const y = padT + (H-padT-padB) * (1 - d.value/maxVal);
    return {x,y,...d};
  });
  const pathD = points.map((p,i)=> (i===0?"M":"L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  const areaD = pathD + ` L${points[points.length-1].x.toFixed(1)},${(H-padB).toFixed(1)} L${points[0].x.toFixed(1)},${(H-padB).toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
      {/* y축 가이드 라인 4개 */}
      {[0,0.25,0.5,0.75,1].map(t=>{
        const y = padT + (H-padT-padB)*(1-t);
        return <line key={t} x1={padL} x2={W-padR} y1={y} y2={y} stroke="#F3F4F6" strokeWidth="1"/>;
      })}
      <path d={areaD} fill={RED_LIGHT} opacity="0.6"/>
      <path d={pathD} fill="none" stroke={RED} strokeWidth="2.5"/>
      {points.map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={RED} strokeWidth="2.5"/>
          <text x={p.x} y={p.y-10} textAnchor="middle" fontSize="10" fill="#374151" fontWeight="700">{p.value>0?fmt(p.value):""}</text>
          <text x={p.x} y={H-padB+18} textAnchor="middle" fontSize="10" fill="#9CA3AF">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ════════════════════════════════════════════════════════
// 콘텐츠 목록
// ════════════════════════════════════════════════════════
function ContentsList({contents,onOpenRegister,onEdit,onDelete,onUpdateAll,updating,updateProgress}) {
  const [search,setSearch]=useState("");
  const [pfFilter,setPfFilter]=useState("전체");
  const [stFilter,setStFilter]=useState("전체");
  const [sortBy,setSortBy]=useState("최근 등록순");
  const [expandedGroups,setExpandedGroups]=useState({});

  const toggleGroup=(key)=>setExpandedGroups(p=>({...p,[key]:!p[key]}));

  const filtered=useMemo(()=>{
    let r=[...contents];
    if(search)r=r.filter(c=>(c.title||c.url||c.groupName||"").toLowerCase().includes(search.toLowerCase()));
    if(pfFilter!=="전체")r=r.filter(c=>c.platform===pfFilter);
    if(stFilter!=="전체")r=r.filter(c=>c.status===stFilter);

    // 그룹명이 있는 것들은 합산해서 하나의 행으로 만들기
    const groupMap={};
    const ungrouped=[];
    r.forEach(c=>{
      if(c.groupName&&c.groupName.trim()){
        const k=c.groupName.trim();
        if(!groupMap[k]) groupMap[k]={
          id:"group_"+k, isGroup:true, groupName:k,
          platforms:[], titles:[], thumbnails:[],
          views:0, likes:0, comments:0, views7d:0, views24h:0,
          effectiveViewsTotal:0, items:[],
          uploadDate:"", campaign:"", manager:"", status:"성공",
        };
        const g=groupMap[k];
        g.items.push(c);
        if(!g.platforms.includes(c.platform))g.platforms.push(c.platform);
        if(c.title)g.titles.push(c.title);
        if(c.thumbnail&&!g.thumbnails.includes(c.thumbnail))g.thumbnails.push(c.thumbnail);
        g.views+=c.views||0;
        g.likes+=c.likes||0;
        g.comments+=c.comments||0;
        g.views7d+=c.views7d||0;
        g.views24h+=c.views24h||0;
        g.effectiveViewsTotal+=effectiveViews(c);
        if(!g.campaign&&c.campaign)g.campaign=c.campaign;
        if(!g.manager&&c.manager)g.manager=c.manager;
        if(!g.uploadDate&&c.uploadDate)g.uploadDate=c.uploadDate;
      } else {
        ungrouped.push({...c, effectiveViewsTotal:effectiveViews(c)});
      }
    });

    // 그룹 대표 제목 = 조회수 가장 높은 항목의 제목
    const groupRows=Object.values(groupMap).map(g=>{
      const topItem=[...g.items].sort((a,b)=>(effectiveViews(b))-(effectiveViews(a)))[0];
      return {...g, title:topItem?.title||g.groupName, thumbnail:topItem?.thumbnail||g.thumbnails[0]||"", url:topItem?.url||"", channel:topItem?.channel||""};
    });

    let result=[...groupRows,...ungrouped];
    if(sortBy==="최근 등록순")result.sort((a,b)=>b.id.toString().localeCompare(a.id.toString()));
    if(sortBy==="조회수 높은순")result.sort((a,b)=>(b.effectiveViewsTotal||b.views||0)-(a.effectiveViewsTotal||a.views||0));
    if(sortBy==="7일 증가순")result.sort((a,b)=>(b.views7d||0)-(a.views7d||0));
    return result;
  },[contents,search,pfFilter,stFilter,sortBy]);

  const campRank=useMemo(()=>{
    const m={};
    contents.forEach(c=>{const k=c.campaign||"미분류";if(!m[k])m[k]={name:k,views:0,growth:0,count:0};m[k].views+=effectiveViews(c);m[k].growth+=c.views7d||0;m[k].count++;});
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
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {updating&&<span style={{fontSize:12,color:RED,fontWeight:600}}>{updateProgress.done}/{updateProgress.total} 처리 중...</span>}
          <button style={C.btnOutline}>↓ CSV</button>
          <button style={{...C.btnOutline,display:"flex",alignItems:"center",gap:6,opacity:updating?0.6:1}} onClick={onUpdateAll} disabled={updating}>
            {updating?<Spinner size={13}/>:"↻"} 전체 지표 업데이트
          </button>
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
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:14,fontWeight:700}}>콘텐츠 리스트 ({filtered.length}건)</div>
            <span style={{fontSize:11,color:"#9CA3AF"}}>※ 인스타그램 좋아요×100 조회수 환산 포함</span>
          </div>
          <select style={{padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:8,fontSize:13}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option>최근 등록순</option><option>조회수 높은순</option><option>7일 증가순</option>
          </select>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{borderBottom:"2px solid "+RED_BORDER,background:RED_LIGHT}}>
                {["콘텐츠","플랫폼","채널","상태","캠페인","담당자","참여 지표","증가 추이","업로드일","액션"].map(h=>(
                  <th key={h} style={{padding:"10px 12px",fontSize:12,fontWeight:700,color:RED,textAlign:h==="콘텐츠"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item,idx)=>{
                const isExpanded = expandedGroups[item.groupName];
                return (
                  <Fragment key={item.id}>
                    <tr style={{borderBottom:"1px solid #FCF0F1",background:item.isGroup?RED_LIGHT:idx%2?"#FFFAFA":"#fff"}}>
                      <td style={{padding:12,verticalAlign:"middle"}}>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          {item.isGroup&&(
                            <button onClick={()=>toggleGroup(item.groupName)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",fontSize:13,color:RED,flexShrink:0}}>
                              {isExpanded?"▲":"▶"}
                            </button>
                          )}
                          <Thumb src={item.thumbnail}/>
                          <div style={{minWidth:0}}>
                            {item.isGroup&&<span style={{fontSize:10,fontWeight:700,color:RED,background:"#FFE4E8",padding:"1px 6px",borderRadius:10,marginBottom:3,display:"inline-block"}}>그룹 {item.items?.length}개</span>}
                            <p style={{margin:0,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:300}}>{item.title||item.groupName||"(제목 없음)"}</p>
                            {!item.isGroup&&<a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#9CA3AF",textDecoration:"none"}}>{item.url?.slice(0,36)}...</a>}
                            {item.isGroup&&<div style={{fontSize:11,color:"#9CA3AF"}}>{item.platforms?.join(" + ")}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}>
                        {item.isGroup
                          ? <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>{item.platforms?.map(p=><PlatformBadge key={p} p={p}/>)}</div>
                          : <PlatformBadge p={item.platform}/>}
                      </td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12,color:"#374151",fontWeight:600,whiteSpace:"nowrap"}}>
                        {item.isGroup?(item.channel||"—"):(item.channel||"—")}
                      </td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}><StatusBadge s={item.status}/></td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12,fontWeight:600}}>{item.campaign||"—"}</td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>{item.manager||"—"}</td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                        <div style={{fontWeight:600}}>조회 {fmtFull(item.effectiveViewsTotal||item.views)}</div>
                        {!item.isGroup&&<div style={{color:"#9CA3AF"}}>♥ {fmtFull(item.likes)} · 💬 {fmtFull(item.comments)}</div>}
                      </td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                        <div style={{color:item.views24h>0?"#16A34A":"#9CA3AF"}}>전주 대비 {item.views24h!==0?((item.views24h>0?"+":"")+fmt(Math.abs(item.views24h))):"—"}</div>
                        <div style={{color:item.views7d>0?"#16A34A":"#9CA3AF"}}>7일 {item.views7d>0?"+"+fmt(item.views7d):"—"}</div>
                      </td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12,color:"#9CA3AF"}}>{item.uploadDate||"—"}</td>
                      <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}>
                        {item.isGroup
                          ? <button onClick={()=>toggleGroup(item.groupName)} style={{padding:"4px 12px",borderRadius:6,border:"1px solid "+RED_BORDER,background:RED_LIGHT,color:RED,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                              {isExpanded?"접기":"펼치기"}
                            </button>
                          : <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                              <a href={item.url} target="_blank" rel="noreferrer" style={{border:"1px solid "+RED_BORDER,borderRadius:6,padding:"4px 8px",fontSize:12,color:RED,textDecoration:"none",fontWeight:600}}>↗</a>
                              <button onClick={()=>onEdit(item)} style={{border:"1px solid #E5E7EB",borderRadius:6,padding:"4px 8px",fontSize:12,color:"#374151",background:"#fff",cursor:"pointer",fontWeight:600}}>✏️</button>
                              <button onClick={()=>onDelete(item)} style={{border:"1px solid #FCA5A5",borderRadius:6,padding:"4px 8px",fontSize:12,color:"#DC2626",background:"#FEF2F2",cursor:"pointer",fontWeight:600}}>🗑</button>
                            </div>
                        }
                      </td>
                    </tr>
                    {item.isGroup && isExpanded && item.items?.map((child)=>(
                      <tr key={child.id} style={{borderBottom:"1px solid #FCF0F1",background:"#FFFBFB"}}>
                        <td style={{padding:"10px 12px 10px 56px",verticalAlign:"middle"}}>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <span style={{fontSize:11,color:"#9CA3AF",flexShrink:0}}>└</span>
                            <Thumb src={child.thumbnail}/>
                            <div style={{minWidth:0}}>
                              <p style={{margin:0,fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260}}>{child.title||"(제목 없음)"}</p>
                              <a href={child.url} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#9CA3AF",textDecoration:"none"}}>{child.url?.slice(0,36)}...</a>
                            </div>
                          </div>
                        </td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle"}}><PlatformBadge p={child.platform}/></td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11,color:"#374151"}}>{child.channel||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle"}}><StatusBadge s={child.status}/></td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11}}>{child.campaign||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11}}>{child.manager||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11}}>
                          <div style={{fontWeight:600}}>조회 {fmtFull(effectiveViews(child))}</div>
                          <div style={{color:"#9CA3AF",fontSize:10}}>♥ {fmtFull(child.likes)} · 💬 {fmtFull(child.comments)}</div>
                        </td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11}}>
                          <div style={{color:child.views7d>0?"#16A34A":"#9CA3AF"}}>7일 {child.views7d>0?"+"+fmt(child.views7d):"—"}</div>
                        </td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle",fontSize:11,color:"#9CA3AF"}}>{child.uploadDate||"—"}</td>
                        <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"middle"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            <a href={child.url} target="_blank" rel="noreferrer" style={{border:"1px solid "+RED_BORDER,borderRadius:6,padding:"3px 7px",fontSize:11,color:RED,textDecoration:"none",fontWeight:600}}>↗</a>
                            <button onClick={()=>onEdit(child)} style={{border:"1px solid #E5E7EB",borderRadius:6,padding:"3px 7px",fontSize:11,color:"#374151",background:"#fff",cursor:"pointer"}}>✏️</button>
                            <button onClick={()=>onDelete(child)} style={{border:"1px solid #FCA5A5",borderRadius:6,padding:"3px 7px",fontSize:11,color:"#DC2626",background:"#FEF2F2",cursor:"pointer"}}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 유튜브 채널 전용 등록 모달
// ════════════════════════════════════════════════════════
function YtRegisterModal({onAdd,onUpdate,onClose,ytApiKey,editItem}) {
  const isEditMode=!!editItem;
  const [form,setForm]=useState(()=>editItem?{
    url:editItem.url||"",title:editItem.title||"",
    campaign:editItem.campaign||"큐레이터알",
    uploadDate:editItem.uploadDate||"",memo:editItem.memo||"",
    manualViews:editItem.views||"",
  }:{url:"",title:"",campaign:"큐레이터알",uploadDate:"",memo:"",manualViews:""});
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [fetchErr,setFetchErr]=useState("");
  const [preview,setPreview]=useState(null);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const handleUrlBlur=async()=>{
    if(!form.url||!ytApiKey)return;
    setLoading(true);setFetchErr("");
    try{
      const s=await fetchYouTubeStats(form.url,ytApiKey);
      setPreview(s);
      if(!form.title)set("title",s.title);
      if(!form.uploadDate)set("uploadDate",s.publishedAt);
      if(s.channel)set("channel",s.channel);
    }catch(e){setFetchErr(e.message);}
    finally{setLoading(false);}
  };

  const handleSave=async()=>{
    if(!form.url.trim())return alert("URL을 입력해주세요.");
    setSaving(true);
    const itemData={
      url:form.url.trim(),
      title:preview?.title||form.title||"",
      thumbnail:preview?.thumbnail||editItem?.thumbnail||"",
      campaign:form.campaign,
      uploadDate:form.uploadDate||preview?.publishedAt||new Date().toISOString().slice(0,10),
      memo:form.memo,
      views:preview?.views||parseInt(form.manualViews)||0,
      likes:preview?.likes||0,
      comments:preview?.comments||0,
      views7d:editItem?.views7d||0,
      viewsLastWeek:editItem?.viewsLastWeek??(preview?.views||parseInt(form.manualViews)||0),
      lastUpdated:new Date().toISOString(),
      platform:"YouTube",
    };
    try{
      if(isEditMode){
        const updated={...itemData,id:editItem.id};
        await sb("yt_contents","PATCH",ytToDB(updated),`?id=eq.${editItem.id}`);
        onUpdate(updated);
      }else{
        const newItem={...itemData,id:Date.now()};
        await sb("yt_contents","POST",ytToDB(newItem));
        onAdd(newItem);
      }
      setSaving(false);onClose();
    }catch(e){setFetchErr("저장 실패: "+e.message);setSaving(false);}
  };

  return(
    <div style={C.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",borderRadius:18,width:"92%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,0.18)"}}>
        <div style={{padding:"22px 28px 18px",borderBottom:"2px solid #FFE0E0",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{isEditMode?"유튜브 영상 수정":"유튜브 영상 등록"}</h2>
            <p style={{margin:"4px 0 0",fontSize:13,color:"#FF0000"}}>📺 유튜브 채널 전용 콘텐츠</p>
          </div>
          <button style={{background:"none",border:"none",fontSize:22,color:"#9CA3AF",cursor:"pointer"}} onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"24px 28px"}}>
          <label style={C.lbl}>YouTube URL *</label>
          <input style={C.inp} value={form.url} onChange={e=>set("url",e.target.value)} onBlur={handleUrlBlur} placeholder="https://youtube.com/watch?v=..."/>
          {loading&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"#FFF8F8",borderRadius:8,marginBottom:12,fontSize:13,color:"#6B7280"}}><Spinner size={13}/>YouTube 데이터 가져오는 중...</div>}
          {fetchErr&&<div style={{padding:"10px 14px",background:"#FEE2E2",borderRadius:8,marginBottom:12,fontSize:13,color:"#991B1B"}}>⚠️ {fetchErr}</div>}
          {preview&&(
            <div style={{padding:14,background:"#FFF8F8",border:"1px solid #FFE0E0",borderRadius:10,marginBottom:16}}>
              <div style={{fontSize:11,color:"#16A34A",fontWeight:700,marginBottom:8}}>✅ YouTube 데이터 자동 가져옴</div>
              {preview.thumbnail&&<img src={preview.thumbnail} alt="" style={{width:"100%",borderRadius:6,marginBottom:8}}/>}
              <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>{preview.title}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[{label:"조회수",value:fmtFull(preview.views)},{label:"좋아요",value:fmtFull(preview.likes)},{label:"댓글",value:fmtFull(preview.comments)}].map(s=>(
                  <div key={s.label} style={{background:"#FFE0E0",borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#6B7280"}}>{s.label}</div>
                    <div style={{fontSize:13,fontWeight:800,color:"#FF0000"}}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <label style={C.lbl}>캠페인 *</label>
          <div style={{display:"flex",gap:10,marginBottom:12}}>
            {["큐레이터알","단독 쇼츠"].map(c=>(
              <button key={c} onClick={()=>set("campaign",c)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`2px solid ${form.campaign===c?"#FF0000":"#E5E7EB"}`,background:form.campaign===c?"#FFF0F0":"#fff",color:form.campaign===c?"#FF0000":"#374151",fontWeight:form.campaign===c?700:400,cursor:"pointer",fontSize:14}}>
                {c}
              </button>
            ))}
          </div>
          <label style={C.lbl}>콘텐츠명</label>
          <input style={C.inp} value={form.title} onChange={e=>set("title",e.target.value)} placeholder="(YouTube URL 입력 시 자동 입력)"/>
          <label style={C.lbl}>업로드일</label>
          <input style={C.inp} type="date" value={form.uploadDate} onChange={e=>set("uploadDate",e.target.value)}/>
          {!ytApiKey&&(
            <div style={{padding:"10px 14px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,marginBottom:12,fontSize:12,color:"#92400E"}}>
              💡 설정에서 YouTube API 키를 입력하면 데이터가 자동으로 불러와집니다.
              <br/>지금은 아래에서 조회수를 직접 입력해주세요.
            </div>
          )}
          {!preview&&(
            <>
              <label style={C.lbl}>조회수 (수동 입력)</label>
              <input style={C.inp} type="number" value={form.manualViews} onChange={e=>set("manualViews",e.target.value)} placeholder="0"/>
            </>
          )}
          <label style={C.lbl}>메모</label>
          <textarea style={{...C.inp,height:70,resize:"vertical"}} value={form.memo} onChange={e=>set("memo",e.target.value)}/>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,padding:"0 28px 24px"}}>
          <button style={C.btnOutline} onClick={onClose}>취소</button>
          <button style={{...C.btnRed,background:"#FF0000",opacity:saving?0.6:1,display:"flex",alignItems:"center",gap:8}} onClick={handleSave} disabled={saving}>
            {saving&&<Spinner size={14}/>}{saving?"저장 중...":isEditMode?"수정 저장":"등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 유튜브 채널 전용 대시보드
// ════════════════════════════════════════════════════════
function YoutubeDashboard({ytContents,onOpenRegister}) {
  const total=ytContents.length;
  const totalViews=ytContents.reduce((s,c)=>s+(c.views||0),0);
  const week=ytContents.reduce((s,c)=>s+(c.views7d||0),0);

  const byCampaign=useMemo(()=>{
    const m={};
    ytContents.forEach(c=>{
      const k=c.campaign||"미분류";
      if(!m[k])m[k]={name:k,count:0,totalViews:0,growth:0,top:null};
      m[k].count++;
      m[k].totalViews+=c.views||0;
      m[k].growth+=c.views7d||0;
      if(!m[k].top||(c.views||0)>(m[k].top.views||0))m[k].top=c;
    });
    return Object.values(m).sort((a,b)=>b.totalViews-a.totalViews);
  },[ytContents]);

  const top10=[...ytContents].sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,10);
  const topGrowth=[...ytContents].sort((a,b)=>(b.views7d||0)-(a.views7d||0)).filter(c=>c.views7d>0).slice(0,10);

  if(total===0)return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>📺 유튜브 채널 대시보드</h1>
      <p style={{margin:"0 0 28px",fontSize:13,color:"#6B7280"}}>큐레이터알 · 단독 쇼츠 채널 관리</p>
      <div style={{...C.card,textAlign:"center",padding:"80px 24px"}}>
        <div style={{fontSize:60,marginBottom:18}}>📺</div>
        <div style={{fontSize:20,fontWeight:700,marginBottom:10}}>등록된 유튜브 영상이 없습니다</div>
        <button style={{...C.btnRed,background:"#FF0000"}} onClick={onOpenRegister}>+ 첫 영상 등록하기</button>
      </div>
    </div>
  );

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>📺 유튜브 채널 대시보드</h1>
      <p style={{margin:"0 0 22px",fontSize:13,color:"#6B7280"}}>큐레이터알 · 단독 쇼츠 채널 성과 · {total}개 영상</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[
          {label:"전체 영상 수",value:total,icon:"🎬"},
          {label:"누적 조회수",value:fmtFull(totalViews),icon:"👁"},
          {label:"큐레이터알",value:ytContents.filter(c=>c.campaign==="큐레이터알").length+"개",icon:"📡"},
          {label:"단독 쇼츠",value:ytContents.filter(c=>c.campaign==="단독 쇼츠").length+"개",icon:"⚡"},
        ].map(s=>(
          <div key={s.label} style={{...C.card,padding:"16px 18px",borderTop:"3px solid #FF0000"}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#6B7280",fontWeight:600}}>{s.label}</span><span style={{fontSize:15}}>{s.icon}</span></div>
            <div style={{fontSize:26,fontWeight:800,color:"#111827",marginTop:6}}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        {byCampaign.map(c=>(
          <div key={c.name} style={{...C.card,borderTop:"3px solid #FF0000"}}>
            <div style={{fontSize:15,fontWeight:800,marginBottom:12}}>{c.name==="큐레이터알"?"📡":"⚡"} {c.name}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {[{label:"영상 수",value:c.count},{label:"총 조회수",value:fmtFull(c.totalViews)},{label:"7일 증가",value:c.growth>0?"+"+fmt(c.growth):"—"}].map(s=>(
                <div key={s.label} style={{border:"1px solid #FFE0E0",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:11,color:"#6B7280",marginBottom:2}}>{s.label}</div>
                  <div style={{fontSize:14,fontWeight:800,color:s.label==="7일 증가"&&c.growth>0?"#16A34A":"#111827"}}>{s.value}</div>
                </div>
              ))}
            </div>
            {c.top&&(
              <div style={{display:"flex",gap:10,padding:"10px 12px",background:"#FFF8F8",borderRadius:8,border:"1px solid #FFE0E0"}}>
                <Thumb src={c.top.thumbnail}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:"#FF0000",fontWeight:700,marginBottom:2}}>최고 조회수</div>
                  <div style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.top.title||c.top.url}</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#111827"}}>{fmtFull(c.top.views)} 회</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[
          {title:"누적 조회수 Top 10",items:top10,vk:"views",label:v=>fmtFull(v.views)+" 회"},
          {title:"🔥 7일 급상승 Top 10",items:topGrowth,vk:"views7d",label:v=>"+"+fmt(v.views7d)},
        ].map(({title,items,label})=>(
          <div key={title} style={C.card}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:14,borderLeft:"3px solid #FF0000",paddingLeft:10}}>{title}</div>
            {items.length===0?<p style={{color:"#9CA3AF",fontSize:13}}>데이터가 없습니다</p>
            :items.map((item,i)=>(
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <span style={{width:18,fontSize:13,fontWeight:700,color:i<3?"#FF0000":"#9CA3AF"}}>{i+1}</span>
                <Thumb src={item.thumbnail}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:10,fontWeight:700,color:item.campaign==="큐레이터알"?"#FF0000":"#F59E0B",marginBottom:1}}>{item.campaign}</div>
                  <p style={{margin:"0 0 1px",fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{item.title||item.url}</p>
                  <a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#9CA3AF"}}>보기 ↗</a>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:"#111827",flexShrink:0}}>{label(item)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 유튜브 채널 전용 콘텐츠 목록
// ════════════════════════════════════════════════════════
function YtContentsList({ytContents,onOpenRegister,onEdit,onDelete,onUpdateAll,updating,updateProgress}) {
  const [search,setSearch]=useState("");
  const [campFilter,setCampFilter]=useState("전체");
  const [sortBy,setSortBy]=useState("최근 등록순");

  const filtered=useMemo(()=>{
    let r=[...ytContents];
    if(search)r=r.filter(c=>(c.title||c.url||"").toLowerCase().includes(search.toLowerCase()));
    if(campFilter!=="전체")r=r.filter(c=>c.campaign===campFilter);
    if(sortBy==="최근 등록순")r.sort((a,b)=>b.id-a.id);
    if(sortBy==="조회수 높은순")r.sort((a,b)=>(b.views||0)-(a.views||0));
    if(sortBy==="7일 증가순")r.sort((a,b)=>(b.views7d||0)-(a.views7d||0));
    return r;
  },[ytContents,search,campFilter,sortBy]);

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>📺 유튜브 콘텐츠</h1>
          <p style={{margin:0,fontSize:13,color:"#6B7280"}}>{filtered.length}건 표시 중</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {updating&&<span style={{fontSize:12,color:"#FF0000",fontWeight:600}}>{updateProgress.done}/{updateProgress.total} 처리 중...</span>}
          <button style={{...C.btnOutline,display:"flex",alignItems:"center",gap:6,opacity:updating?0.6:1}} onClick={onUpdateAll} disabled={updating}>
            {updating?<Spinner size={13}/>:"↻"} 지표 업데이트
          </button>
          <button style={{...C.btnRed,background:"#FF0000"}} onClick={onOpenRegister}>+ 영상 등록</button>
        </div>
      </div>
      <div style={{...C.card,marginBottom:20,padding:16}}>
        <div style={{display:"flex",gap:10,marginBottom:10}}>
          <input style={{...C.inp,marginBottom:0,flex:1}} placeholder="영상 검색..." value={search} onChange={e=>setSearch(e.target.value)}/>
          {["전체","큐레이터알","단독 쇼츠"].map(c=>(
            <button key={c} onClick={()=>setCampFilter(c)} style={{padding:"9px 16px",border:`1px solid ${campFilter===c?"#FF0000":"#E5E7EB"}`,borderRadius:8,background:campFilter===c?"#FFF0F0":"#fff",color:campFilter===c?"#FF0000":"#374151",fontSize:13,fontWeight:campFilter===c?700:400,cursor:"pointer",whiteSpace:"nowrap"}}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {filtered.length===0?(
        <div style={{...C.card,textAlign:"center",padding:"60px 24px"}}>
          <div style={{fontSize:40,marginBottom:12}}>📺</div>
          <div style={{fontSize:16,fontWeight:700,marginBottom:10}}>등록된 영상이 없습니다</div>
          <button style={{...C.btnRed,background:"#FF0000"}} onClick={onOpenRegister}>+ 영상 등록하기</button>
        </div>
      ):(
        <div style={C.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:14,fontWeight:700}}>영상 목록 ({filtered.length}건)</div>
            <select style={{padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:8,fontSize:13}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
              <option>최근 등록순</option><option>조회수 높은순</option><option>7일 증가순</option>
            </select>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{borderBottom:"2px solid #FFE0E0",background:"#FFF8F8"}}>
                  {["영상","캠페인","조회수","7일 증가","업로드일","액션"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",fontSize:12,fontWeight:700,color:"#FF0000",textAlign:h==="영상"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item,idx)=>(
                  <tr key={item.id} style={{borderBottom:"1px solid #FFF0F0",background:idx%2?"#FFFAFA":"#fff"}}>
                    <td style={{padding:12,verticalAlign:"middle"}}>
                      <div style={{display:"flex",gap:10,alignItems:"center"}}>
                        <Thumb src={item.thumbnail}/>
                        <div style={{minWidth:0}}>
                          <p style={{margin:0,fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>{item.title||"(제목 없음)"}</p>
                          <a href={item.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#9CA3AF",textDecoration:"none"}}>{item.url?.slice(0,36)}...</a>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}>
                      <span style={{padding:"3px 10px",borderRadius:20,background:item.campaign==="큐레이터알"?"#FEE2E2":"#FEF3C7",color:item.campaign==="큐레이터알"?"#FF0000":"#F59E0B",fontSize:12,fontWeight:700}}>{item.campaign}</span>
                    </td>
                    <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12}}>
                      <div style={{fontWeight:700,fontSize:13}}>{fmtFull(item.views)}</div>
                      <div style={{color:"#9CA3AF",fontSize:11}}>♥ {fmtFull(item.likes)} · 💬 {fmtFull(item.comments)}</div>
                    </td>
                    <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:13,fontWeight:700,color:item.views7d>0?"#16A34A":"#9CA3AF"}}>
                      {item.views7d>0?"+"+fmt(item.views7d):"—"}
                    </td>
                    <td style={{padding:12,textAlign:"center",verticalAlign:"middle",fontSize:12,color:"#9CA3AF"}}>{item.uploadDate||"—"}</td>
                    <td style={{padding:12,textAlign:"center",verticalAlign:"middle"}}>
                      <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                        <a href={item.url} target="_blank" rel="noreferrer" style={{border:"1px solid #FFE0E0",borderRadius:6,padding:"4px 8px",fontSize:12,color:"#FF0000",textDecoration:"none",fontWeight:600}}>↗</a>
                        <button onClick={()=>onEdit(item)} style={{border:"1px solid #E5E7EB",borderRadius:6,padding:"4px 8px",fontSize:12,color:"#374151",background:"#fff",cursor:"pointer"}}>✏️</button>
                        <button onClick={()=>onDelete(item)} style={{border:"1px solid #FCA5A5",borderRadius:6,padding:"4px 8px",fontSize:12,color:"#DC2626",background:"#FEF2F2",cursor:"pointer"}}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Campaigns({contents}) {
  const campaigns=useMemo(()=>{
    const m={};
    contents.forEach(c=>{const k=c.campaign||"미분류";if(!m[k])m[k]={name:k,items:[]};m[k].items.push(c);});
    return Object.values(m).map(g=>({
      name:g.name,count:g.items.length,
      totalViews:g.items.reduce((s,c)=>s+effectiveViews(c),0),
      avgViews:Math.round(g.items.reduce((s,c)=>s+effectiveViews(c),0)/g.items.length),
      growth:g.items.reduce((s,c)=>s+(c.views7d||0),0),
      growth24h:g.items.reduce((s,c)=>s+(c.views24h||0),0),
      yt:g.items.filter(c=>c.platform==="YouTube").length,
      ig:g.items.filter(c=>c.platform?.includes("Instagram")).length,
      th:g.items.filter(c=>c.platform==="Threads").length,
      top:[...g.items].sort((a,b)=>effectiveViews(b)-effectiveViews(a))[0],
    })).sort((a,b)=>b.totalViews-a.totalViews);
  },[contents]);

  if(contents.length===0)return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>캠페인별 분석</h1>
      <div style={{...C.card,textAlign:"center",padding:"80px 24px",marginTop:24}}>
        <div style={{fontSize:60,marginBottom:18}}>📢</div>
        <div style={{fontSize:20,fontWeight:700,marginBottom:10}}>캠페인 데이터가 없습니다</div>
      </div>
    </div>
  );

  return(
    <div>
      <h1 style={{margin:"0 0 4px",fontSize:24,fontWeight:800}}>캠페인별 분석</h1>
      <p style={{margin:"0 0 24px",fontSize:13,color:"#6B7280"}}>{campaigns.length}개 그룹</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(460px, 1fr))",gap:16}}>
        {campaigns.map(c=>(
          <div key={c.name} style={{...C.card,borderTop:"3px solid "+RED}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:15,fontWeight:800}}>{c.name}</h3>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {[
                {label:"콘텐츠 수",value:c.count},
                {label:"총 조회수",value:fmt(c.totalViews)},
                {label:"평균 조회수",value:fmt(c.avgViews)},
                {label:"누적 증가",value:c.growth>0?"+"+fmt(c.growth):"—",green:true},
                {label:"24h 증가",value:c.growth24h>0?"+"+fmt(c.growth24h):"—",green:true},
                {label:"7일 증가",value:c.growth>0?"+"+fmt(c.growth):"—",green:true},
              ].map(s=>(
                <div key={s.label} style={{border:"1px solid "+RED_BORDER,borderRadius:8,padding:"8px 10px",minWidth:0}}>
                  <div style={{fontSize:10,color:"#6B7280",marginBottom:3,whiteSpace:"nowrap"}}>{s.label}</div>
                  <div style={{fontSize:13,fontWeight:800,color:s.green&&s.value!=="—"?"#16A34A":"#111827",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.value}</div>
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

// ════════════════════════════════════════════════════════
// 회원 관리 (DB 연동)
// ════════════════════════════════════════════════════════
function MemberAdmin({users,refreshUsers,currentUser}) {
  const [filter,setFilter]=useState("전체");
  if(currentUser.role!=="admin")return<div style={{...C.card,textAlign:"center",padding:60}}><div style={{fontSize:48,marginBottom:16}}>🔒</div><div style={{fontSize:18,fontWeight:700}}>관리자 전용 페이지입니다</div></div>;
  const filtered=filter==="전체"?users:users.filter(u=>u.status===filter);

  const updateStatus=async(id,status)=>{
    try{ await sb("users","PATCH",{status},`?id=eq.${id}`); await refreshUsers(); }
    catch(e){ alert("업데이트 실패: "+e.message); }
  };
  const deleteUser=async(id)=>{
    if(id===1)return alert("관리자 계정은 삭제할 수 없습니다.");
    if(!window.confirm("정말 삭제하시겠습니까?"))return;
    try{ await sb("users","DELETE",null,`?id=eq.${id}`); await refreshUsers(); }
    catch(e){ alert("삭제 실패: "+e.message); }
  };

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

// ════════════════════════════════════════════════════════
// 메인 앱
// ════════════════════════════════════════════════════════
export default function App() {
  const [initLoading,setInitLoading]=useState(true);
  const [initError,setInitError]=useState("");
  const [users,setUsers]=useState([]);
  const [currentUser,setCurrentUser]=useState(()=>{
    try{ const saved=localStorage.getItem("sns_current_user"); return saved?JSON.parse(saved):null; }
    catch{ return null; }
  });
  const [page,setPage]=useState("dashboard");
  const [showRegister,setShowRegister]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [showYtRegister,setShowYtRegister]=useState(false);
  const [ytEditItem,setYtEditItem]=useState(null);
  const [contents,setContents]=useState([]);
  const [settings,setSettings]=useState({ytApiKey:"",apifyToken:""});
  const [viewHistory,setViewHistory]=useState([]);
  const [monthlyGoals,setMonthlyGoals]=useState({});
  const [ytContents,setYtContents]=useState([]);
  const [updating,setUpdating]=useState(false);
  const [updateProgress,setUpdateProgress]=useState({done:0,total:0});

  const WEEK_MS = 7*24*60*60*1000;

  // 실제 업데이트 로직 (targetContents/targetSettings를 인자로 받아 어디서든 재사용 가능)
  const runUpdate = async (targetContents, targetSettings, silent=false) => {
    const targets = targetContents.filter(c => c.platform==="YouTube" || c.platform?.includes("Instagram"));
    if (targets.length===0) {
      if(!silent) alert("자동 업데이트 가능한 콘텐츠(YouTube/Instagram)가 없습니다.");
      return;
    }
    if (!targetSettings.ytApiKey && !targetSettings.apifyToken) {
      if(!silent) alert("설정 페이지에서 YouTube API 키 또는 Apify 토큰을 먼저 등록해주세요.");
      return;
    }
    setUpdating(true);
    setUpdateProgress({done:0,total:targets.length});

    const nowISO = new Date().toISOString();
    const updatedList = [...targetContents];

    for (let i=0; i<targets.length; i++) {
      const item = targets[i];
      try {
        let fresh = null;
        if (item.platform==="YouTube" && targetSettings.ytApiKey) {
          fresh = await fetchYouTubeStats(item.url, targetSettings.ytApiKey);
        } else if (item.platform?.includes("Instagram") && targetSettings.apifyToken) {
          fresh = await fetchInstagramStats(item.url, targetSettings.apifyToken);
        }
        if (fresh && fresh.views!=null) {
          const baseline = item.viewsLastWeek ?? item.views ?? 0;
          const weeklyGrowth = Math.max(0, fresh.views - baseline);
          // 전주 대비 증가분: 이번 주 증가 - 지난 주 증가
          const prevWeeklyGrowth = item.views7d || 0;
          const weekOverWeek = weeklyGrowth - prevWeeklyGrowth;
          // 썸네일 Storage 업로드 (아직 임시 URL인 경우만)
          const newThumb = fresh.thumbnail || item.thumbnail;
          const thumbnail = await uploadThumbnail(newThumb, item.id);
          const updated = {
            ...item,
            views: fresh.views,
            likes: fresh.likes ?? item.likes,
            comments: fresh.comments ?? item.comments,
            thumbnail,
            channel: fresh.channel || item.channel || "", // 채널명도 갱신
            views7d: weeklyGrowth,
            views24h: weekOverWeek,
            viewsLastWeek: fresh.views,
            lastUpdated: nowISO,
            viewsOffset: item.viewsOffset||0,
          };
          await sb("contents","PATCH",contentToDB(updated),`?id=eq.${item.id}`);
          // 월별/주별 집계를 위한 이력 기록 (증가분이 있을 때만)
          if (weeklyGrowth > 0) {
            try {
              await sb("view_history","POST",{
                id: Date.now()+Math.floor(Math.random()*1000),
                content_id: item.id,
                views_at_update: fresh.views,
                growth: weeklyGrowth,
                recorded_at: nowISO,
              });
            } catch(histErr) {
              console.warn("이력 기록 실패:", histErr.message);
            }
          }
          const idx = updatedList.findIndex(c=>c.id===item.id);
          if (idx>=0) updatedList[idx]=updated;
        }
      } catch(e) {
        console.warn(`업데이트 실패 (${item.title||item.url}):`, e.message);
      }
      setUpdateProgress({done:i+1,total:targets.length});
      await new Promise(r=>setTimeout(r, 300));
    }

    setContents(updatedList);
    setUpdating(false);
    try {
      const freshHistory = await sb("view_history","GET",null,"?order=recorded_at.desc&limit=2000");
      setViewHistory((freshHistory||[]).map(h=>({ id:h.id, contentId:h.content_id, growth:h.growth, viewsAtUpdate:h.views_at_update, recordedAt:h.recorded_at })));
    } catch(e) { console.warn("이력 새로고침 실패:", e.message); }
    if(!silent) alert(`업데이트 완료! ${targets.length}개 콘텐츠의 조회수가 갱신되었습니다.`);
  };

  // 버튼 클릭용 — 현재 state를 그대로 사용
  const handleUpdateAll = () => runUpdate(contents, settings, false);

  const loadAll=async()=>{
    try{
      const [contentRows, userRows, settingsRows, historyRows, goalRows, ytRows] = await Promise.all([
        sb("contents","GET",null,"?order=id.desc"),
        sb("users","GET"),
        sb("app_settings","GET",null,"?id=eq.1"),
        sb("view_history","GET",null,"?order=recorded_at.desc&limit=2000"),
        sb("monthly_goals","GET"),
        sb("yt_contents","GET",null,"?order=id.desc"),
      ]);
      const loadedContents = (contentRows||[]).map(contentFromDB);
      const loadedSettings = { ytApiKey: settingsRows?.[0]?.yt_api_key||"", apifyToken: settingsRows?.[0]?.apify_token||"" };
      const loadedHistory = (historyRows||[]).map(h=>({ id:h.id, contentId:h.content_id, growth:h.growth, viewsAtUpdate:h.views_at_update, recordedAt:h.recorded_at }));
      const loadedGoals = {};
      (goalRows||[]).forEach(g=>{ loadedGoals[g.month]=g.goal; });
      setContents(loadedContents);
      setUsers((userRows||[]).map(userFromDB));
      setSettings(loadedSettings);
      setViewHistory(loadedHistory);
      setMonthlyGoals(loadedGoals);
      setYtContents((ytRows||[]).map(ytFromDB));
      return { contents: loadedContents, settings: loadedSettings };
    }catch(e){
      setInitError(e.message);
      return null;
    }finally{
      setInitLoading(false);
    }
  };

  // 앱 최초 로딩 시: 마지막 갱신으로부터 7일 이상 지난 콘텐츠가 있으면 자동(조용히) 업데이트
  useEffect(()=>{
    (async () => {
      const data = await loadAll();
      if (!data) return;
      const { contents: loadedContents, settings: loadedSettings } = data;
      if (!loadedSettings.ytApiKey && !loadedSettings.apifyToken) return;
      const targets = loadedContents.filter(c => c.platform==="YouTube" || c.platform?.includes("Instagram"));
      if (targets.length===0) return;
      const now = Date.now();
      const needsUpdate = targets.some(c => !c.lastUpdated || (now - new Date(c.lastUpdated).getTime()) >= WEEK_MS);
      if (needsUpdate) await runUpdate(loadedContents, loadedSettings, true);
    })();
  },[]);

  const isAdmin=currentUser?.role==="admin";
  const [workspace,setWorkspace]=useState("picasso"); // "picasso" | "youtube"
  const [showWorkspaceDrop,setShowWorkspaceDrop]=useState(false);

  // 워크스페이스 전환 시 기본 페이지로 이동
  const switchWorkspace=(ws)=>{
    setWorkspace(ws);
    setPage(ws==="picasso"?"dashboard":"yt_dashboard");
    setShowWorkspaceDrop(false);
  };

  const isYT = workspace==="youtube";
  const BLUE="#1A73E8";
  const BLUE_DARK="#1557B0";
  const BLUE_LIGHT="#EEF4FD";
  const BLUE_BORDER="#BDD5FB";
  const THEME={ bg: isYT?"#F0F4FF":"#FDF8F8", navBorder: isYT?BLUE_BORDER:RED_BORDER, navShadow: isYT?"rgba(26,115,232,0.07)":"rgba(192,0,26,0.07)", accent: isYT?BLUE:RED, accentDark: isYT?BLUE_DARK:RED_DARK, accentLight: isYT?BLUE_LIGHT:RED_LIGHT };

  const nav = isYT ? [
    {key:"yt_dashboard",label:"유튜브 대시보드"},
    {key:"yt_contents",label:"유튜브 콘텐츠"},
  ] : [
    {key:"dashboard",label:"대시보드"},
    {key:"contents",label:"콘텐츠"},
    {key:"campaigns",label:"캠페인"},
    ...(isAdmin?[{key:"members",label:"👥 회원 관리"},{key:"settings",label:"⚙️ 설정"}]:[]),
  ];

  if(initLoading) return <FullPageLoader msg="데이터를 불러오는 중..."/>;

  if(initError) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"#FDF8F8"}}>
      <div style={{...C.card,maxWidth:480,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
        <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>데이터 연결 실패</div>
        <div style={{fontSize:13,color:"#6B7280",marginBottom:16}}>{initError}</div>
        <div style={{fontSize:12,color:"#9CA3AF"}}>SUPABASE_URL / SUPABASE_KEY 값이 올바른지, 테이블이 생성됐는지 확인해주세요.</div>
      </div>
    </div>
  );

  if(!currentUser) return <AuthScreen onLogin={u=>{setCurrentUser(u);localStorage.setItem("sns_current_user",JSON.stringify(u));setPage("dashboard");}}/>;

  const apiStatus=()=>{
    const yt=!!settings.ytApiKey; const ig=!!settings.apifyToken;
    if(yt&&ig)return{color:"#16A34A",label:"YouTube · Instagram 연결됨",dot:"#16A34A"};
    if(yt)return{color:"#D97706",label:"YouTube만 연결됨",dot:"#D97706"};
    if(ig)return{color:"#D97706",label:"Instagram만 연결됨",dot:"#D97706"};
    return null;
  };
  const status=isAdmin?apiStatus():null;

  const handleDeleteContent = async (item) => {
    if (!window.confirm(`"${item.title||item.url}"\n정말 삭제하시겠습니까?`)) return;
    try {
      await sb("contents","DELETE",null,`?id=eq.${item.id}`);
      setContents(prev => prev.filter(c => c.id !== item.id));
    } catch(e) {
      alert("삭제 실패: " + e.message);
    }
  };

  const handleDeleteYt = async (item) => {
    if (!window.confirm(`"${item.title||item.url}"\n정말 삭제하시겠습니까?`)) return;
    try {
      await sb("yt_contents","DELETE",null,`?id=eq.${item.id}`);
      setYtContents(prev => prev.filter(c => c.id !== item.id));
    } catch(e) {
      alert("삭제 실패: " + e.message);
    }
  };

  const handleUpdateYt = async () => {
    if (!settings.ytApiKey) { alert("설정 페이지에서 YouTube API 키를 먼저 등록해주세요."); return; }
    if (ytContents.length===0) { alert("등록된 유튜브 영상이 없습니다."); return; }
    setUpdating(true);
    setUpdateProgress({done:0,total:ytContents.length});
    const nowISO=new Date().toISOString();
    const updatedList=[...ytContents];
    for(let i=0;i<ytContents.length;i++){
      const item=ytContents[i];
      try{
        const fresh=await fetchYouTubeStats(item.url,settings.ytApiKey);
        if(fresh&&fresh.views!=null){
          const baseline=item.viewsLastWeek??item.views??0;
          const growth=Math.max(0,fresh.views-baseline);
          const updated={...item,views:fresh.views,likes:fresh.likes??item.likes,comments:fresh.comments??item.comments,thumbnail:fresh.thumbnail||item.thumbnail,views7d:growth,viewsLastWeek:fresh.views,lastUpdated:nowISO};
          await sb("yt_contents","PATCH",ytToDB(updated),`?id=eq.${item.id}`);
          const idx=updatedList.findIndex(c=>c.id===item.id);
          if(idx>=0)updatedList[idx]=updated;
        }
      }catch(e){console.warn(`YT 업데이트 실패:`,e.message);}
      setUpdateProgress({done:i+1,total:ytContents.length});
      await new Promise(r=>setTimeout(r,300));
    }
    setYtContents(updatedList);
    setUpdating(false);
    alert(`유튜브 영상 ${ytContents.length}개 업데이트 완료!`);
  };

  return(
    <div style={{minHeight:"100vh",background:THEME.bg,fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',sans-serif"}}>
      <style>{`*{box-sizing:border-box;}button{transition:all 0.15s;font-family:inherit;}button:hover{opacity:0.82;}@keyframes spin{to{transform:rotate(360deg);}}input:focus,textarea:focus,select:focus{outline:none;border-color:${THEME.accent}!important;box-shadow:0 0 0 3px ${isYT?"rgba(26,115,232,0.1)":"rgba(192,0,26,0.1)"};}`}</style>

      <nav style={{background:"#fff",borderBottom:`2px solid ${THEME.navBorder}`,position:"sticky",top:0,zIndex:9990,boxShadow:`0 1px 8px ${THEME.navShadow}`}}>
        <div style={{maxWidth:1300,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",height:58,gap:4,overflowX:"auto",whiteSpace:"nowrap"}}>

          {/* 워크스페이스 드롭다운 로고 */}
          <div style={{position:"relative",marginRight:16,flexShrink:0}}>
            <button onClick={()=>setShowWorkspaceDrop(d=>!d)} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderRadius:10,border:`1px solid ${THEME.navBorder}`,background:THEME.accentLight,cursor:"pointer"}}>
              <div style={{width:28,height:28,background:THEME.accent,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
                {isYT?"📺":"📊"}
              </div>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:12,fontWeight:800,color:THEME.accent,lineHeight:1.2}}>{isYT?"유튜브 채널":"피카소 TF"}</div>
                <div style={{fontSize:10,color:"#9CA3AF"}}>{isYT?"큐레이터알 · 단독 쇼츠":"조회수 모니터링"}</div>
              </div>
              <span style={{fontSize:10,color:"#9CA3AF",marginLeft:2}}>▼</span>
            </button>
          </div>

          {nav.map(item=>(
            <button key={item.key}
              style={{padding:"7px 12px",borderRadius:8,border:"none",background:page===item.key?THEME.accent:"transparent",color:page===item.key?"#fff":"#374151",fontSize:13,fontWeight:600,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}
              onClick={()=>setPage(item.key)}>
              {item.label}
            </button>
          ))}

          <div style={{flex:1,minWidth:8}}/>

          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
            {!isYT&&isAdmin&&(status?(
              <span style={{fontSize:12,color:status.color,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:status.dot,display:"inline-block"}}/>
                {status.label}
              </span>
            ):(
              <button onClick={()=>setPage("settings")} style={{fontSize:12,color:"#D97706",fontWeight:600,background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>
                ⚠️ API 설정 필요
              </button>
            ))}

            <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 14px",border:`1px solid ${THEME.navBorder}`,borderRadius:8,background:THEME.accentLight}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:THEME.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff"}}>{currentUser.name[0]}</div>
              <span style={{fontSize:13,fontWeight:700,color:THEME.accent}}>{currentUser.name}</span>
              <span style={{color:THEME.navBorder,fontSize:16}}>|</span>
              <button style={{background:"none",border:"none",fontSize:12,color:"#9CA3AF",cursor:"pointer",padding:0,fontFamily:"inherit"}} onClick={()=>{setCurrentUser(null);localStorage.removeItem("sns_current_user");setPage("dashboard");setWorkspace("picasso");}}>로그아웃</button>
            </div>
          </div>
        </div>
      </nav>

      {/* 드롭다운 외부 클릭 시 닫기 */}
      {showWorkspaceDrop&&<div style={{position:"fixed",inset:0,zIndex:9998}} onClick={()=>setShowWorkspaceDrop(false)}/>}
      {showWorkspaceDrop&&(
        <div style={{position:"fixed",top:64,left:16,background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,0.15)",zIndex:9999,minWidth:200,overflow:"hidden"}}>
          <div style={{padding:"8px 0"}}>
            <div style={{padding:"4px 12px",fontSize:11,color:"#9CA3AF",fontWeight:700}}>워크스페이스 선택</div>
            {[
              {key:"picasso",label:"피카소 TF",sub:"대시보드 · 콘텐츠 · 캠페인",icon:"📊",color:RED},
              {key:"youtube",label:"유튜브 채널",sub:"큐레이터알 · 단독 쇼츠",icon:"📺",color:BLUE},
            ].map(w=>(
              <button key={w.key} onClick={()=>switchWorkspace(w.key)}
                style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 14px",border:"none",background:workspace===w.key?`${w.color}10`:"#fff",cursor:"pointer",textAlign:"left"}}>
                <div style={{width:28,height:28,background:w.color,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{w.icon}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:workspace===w.key?w.color:"#111827"}}>{w.label}</div>
                  <div style={{fontSize:11,color:"#9CA3AF"}}>{w.sub}</div>
                </div>
                {workspace===w.key&&<span style={{marginLeft:"auto",color:w.color,fontSize:14}}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <main style={{maxWidth:1300,margin:"0 auto",padding:"28px 24px"}}>
        {page==="dashboard"&&<Dashboard contents={contents} viewHistory={viewHistory} monthlyGoals={monthlyGoals} onOpenRegister={()=>setShowRegister(true)}/>}
        {page==="contents"&&<ContentsList contents={contents} onOpenRegister={()=>setShowRegister(true)} onEdit={item=>setEditItem(item)} onDelete={handleDeleteContent} onUpdateAll={handleUpdateAll} updating={updating} updateProgress={updateProgress}/>}
        {page==="campaigns"&&<Campaigns contents={contents}/>}
        {page==="yt_dashboard"&&<YoutubeDashboard ytContents={ytContents} onOpenRegister={()=>setShowYtRegister(true)}/>}
        {page==="yt_contents"&&<YtContentsList ytContents={ytContents} onOpenRegister={()=>setShowYtRegister(true)} onEdit={item=>setYtEditItem(item)} onDelete={handleDeleteYt} onUpdateAll={handleUpdateYt} updating={updating} updateProgress={updateProgress}/>}
        {page==="members"&&<MemberAdmin users={users} refreshUsers={loadAll} currentUser={currentUser}/>}
        {page==="settings"&&<Settings settings={settings} refreshSettings={loadAll} currentUser={currentUser} monthlyGoals={monthlyGoals} refreshGoals={loadAll}/>}
      </main>

      {showRegister&&<RegisterModal onAdd={item=>setContents(p=>[item,...p])} onClose={()=>setShowRegister(false)} ytApiKey={settings.ytApiKey} apifyToken={settings.apifyToken} allContents={contents}/>}
      {editItem&&<RegisterModal editItem={editItem} onUpdate={updated=>setContents(prev=>prev.map(c=>c.id===updated.id?updated:c))} onClose={()=>setEditItem(null)} ytApiKey={settings.ytApiKey} apifyToken={settings.apifyToken} allContents={contents}/>}
      {showYtRegister&&<YtRegisterModal onAdd={item=>setYtContents(p=>[item,...p])} onClose={()=>setShowYtRegister(false)} ytApiKey={settings.ytApiKey}/>}
      {ytEditItem&&<YtRegisterModal editItem={ytEditItem} onUpdate={updated=>setYtContents(prev=>prev.map(c=>c.id===updated.id?updated:c))} onClose={()=>setYtEditItem(null)} ytApiKey={settings.ytApiKey}/>}
    </div>
  );
}
