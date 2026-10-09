import './styles.css';
import { setHandler, start } from './router';
import { homeView } from './home';
import { scanView, isSafeView } from './scan';
import { compareView } from './compare';
import { launchesView } from './launches';
import { pricingView } from './pricing';
import { checkoutView } from './checkout';
import { apiView, legalView, notFoundView } from './pages';

const root = document.getElementById('app')!;

setHandler(async (path, params) => {
  let m: RegExpMatchArray | null;
  if (path === '/') return homeView(root);
  if ((m = path.match(/^\/scan\/([a-z]+)\/([A-Za-z0-9]+)$/))) return scanView(root, m[1], m[2]);
  if ((m = path.match(/^\/is\/(.+)-safe$/))) return isSafeView(root, decodeURIComponent(m[1]), params);
  if (path === '/compare') return compareView(root, params);
  if (path === '/launches') return launchesView(root, params);
  if (path === '/pricing') return pricingView(root, params);
  if (path === '/checkout') return checkoutView(root, params);
  if (path === '/api') return apiView(root);
  if (path === '/terms' || path === '/privacy' || path === '/refunds') return legalView(root, path.slice(1) as 'terms');
  return notFoundView(root);
});

document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('#burger')) document.getElementById('nav')?.classList.toggle('open');
});

start();
