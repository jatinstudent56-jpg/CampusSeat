document.addEventListener("DOMContentLoaded", () => {
  const button=document.getElementById("themeToggleBtn"), loader=document.getElementById("pageLoader");
  applyTheme(localStorage.getItem("campusseat-theme")||"dark",button);
  button?.addEventListener("click",()=>applyTheme(document.body.dataset.theme==="dark"?"light":"dark",button));
  if(loader){let revealed=false;const reveal=()=>{if(revealed)return;revealed=true;loader.classList.add("is-hidden");document.body.classList.remove("is-loading");setTimeout(()=>loader.remove(),400);};setTimeout(reveal,1200);window.addEventListener("load",()=>setTimeout(reveal,250),{once:true});}
});
function applyTheme(theme,button){const dark=theme!=="light";document.body.dataset.theme=dark?"dark":"light";document.body.classList.toggle("dark-mode",dark);localStorage.setItem("campusseat-theme",dark?"dark":"light");if(button){button.textContent=dark?"☀ Light":"◐ Dark";button.setAttribute("aria-label",dark?"Switch to light theme":"Switch to dark theme");}}
