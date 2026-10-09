import { BASE } from './ui';

type Handler = (path: string, params: URLSearchParams) => void | Promise<void>;
let handler: Handler = () => {};

export function setHandler(h: Handler) { handler = h; }

export function currentPath(): string {
  let p = location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  p = p.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return p || '/';
}

export function navigate(to: string, replace = false) {
  const url = to.startsWith(BASE + '/') || to === BASE ? to : BASE + (to.startsWith('/') ? to : '/' + to);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.scrollTo(0, 0);
  render();
}

export function render() { void handler(currentPath(), new URLSearchParams(location.search)); }

export function start() {
  window.addEventListener('popstate', render);
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
  });
  render();
}
