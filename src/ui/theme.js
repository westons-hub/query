// Light/dark switch. The initial theme is set by the inline script in index.html.

const listeners = new Set();
export const onThemeChange = (fn) => listeners.add(fn);

export function setupTheme(button) {
  const root = document.documentElement;
  const label = () => { button.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; };
  label();
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('query.theme', root.dataset.theme); } catch { /* private mode: theme just won't be remembered */ }
    label();
    listeners.forEach((fn) => fn());
  });
}
