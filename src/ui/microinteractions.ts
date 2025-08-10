export function initMicroInteractions(){
  // ripple on buttons with .ripple-host
  const addRipple = (el: HTMLElement)=>{
    el.addEventListener('pointerdown', (e)=>{
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
      el.appendChild(ripple);
      ripple.addEventListener('animationend', ()=> ripple.remove());
    });
  };

  document.querySelectorAll('.btn').forEach(btn=>{
    (btn as HTMLElement).classList.add('ripple-host');
    addRipple(btn as HTMLElement);
  });
}
