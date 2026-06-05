const u="data-nadsafe-autofill";function c(){const o=[],r=document.querySelectorAll("form");for(const t of r){const n=t.querySelector('input[type="password"]');if(!n)continue;const e=t.querySelector('input[type="email"]')||t.querySelector('input[type="text"][autocomplete*="user"]')||t.querySelector('input[type="text"][autocomplete*="email"]')||t.querySelector('input[type="text"]');o.push({form:t,usernameInput:e,passwordInput:n})}return o}async function a(){const o=c();if(o.length===0||(await chrome.runtime.sendMessage({type:"GET_STATUS"})).locked)return;const t=await chrome.runtime.sendMessage({type:"AUTOFILL_QUERY",url:location.href});if(!(!t.matches||t.matches.length===0))for(const{usernameInput:n,passwordInput:e}of o)e.getAttribute(u)||(l(n,e,t.matches),e.setAttribute(u,"1"))}function l(o,r,t){const n=r.parentElement;if(!n)return;const e=document.createElement("button");e.type="button",e.textContent="🔑 NadSafe",e.style.cssText=`
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: #4f6ef7;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    z-index: 99999;
  `;const s=(n.style.position,n);s.style.position="relative",s.appendChild(e),e.addEventListener("click",()=>{const i=t[0];o&&(o.value=i.username),chrome.runtime.sendMessage({type:"FILL_PASSWORD",itemId:i.id})})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",a):a();
