// Selecta 3D — menu do botão direito: "Salvar link…" e "Salvar esta página…".
// Abre a mesma tela do botão da extensão numa janelinha, já com o link escolhido.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'org3d-link', title: 'Salvar link no Selecta 3D', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'org3d-pagina', title: 'Salvar esta página no Selecta 3D', contexts: ['page', 'image'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const link = info.menuItemId === 'org3d-link' ? info.linkUrl : (info.pageUrl || (tab && tab.url) || '');
  if (!link) return;
  const q = new URLSearchParams({ link, aba: tab && tab.id >= 0 ? String(tab.id) : '' });
  if (info.selectionText) q.set('nome', info.selectionText.slice(0, 200));
  if (info.mediaType === 'image' && info.srcUrl) q.set('imagem', info.srcUrl);
  chrome.windows.create({ url: 'popup.html?' + q.toString(), type: 'popup', width: 440, height: 720 });
});

// Modelo 3D baixado (3MF, STL, STEP, OBJ): abre a janela para escolher o projeto e anotar a licença.
// Os outros downloads são ignorados.
const EXTS_MODELO = /\.(3mf|stl|step|stp|obj)$/i;
chrome.downloads.onChanged.addListener(async (mudou) => {
  if (!mudou.state || mudou.state.current !== 'complete') return;
  const [item] = await chrome.downloads.search({ id: mudou.id });
  if (!item || !EXTS_MODELO.test(item.filename || '')) return;
  // a página do modelo: a aba de onde veio o download (pelo endereço de origem) ou a aba ativa
  let aba = null;
  const abas = await chrome.tabs.query({});
  if (item.referrer) aba = abas.find((t) => t.url && t.url.split('#')[0] === item.referrer.split('#')[0]) || null;
  if (!aba) [aba] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const q = new URLSearchParams({ baixado: String(item.id), aba: aba && aba.id >= 0 ? String(aba.id) : '' });
  chrome.windows.create({ url: 'popup.html?' + q.toString(), type: 'popup', width: 460, height: 760 });
});
