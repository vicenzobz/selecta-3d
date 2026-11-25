// Página de etiquetas com QR para rolos e insumos (abre no navegador para imprimir).
(async () => {
  const q = new URLSearchParams(location.search);
  const token = q.get('t') || '';
  const ids = (q.get('ids') || '').split(',').filter(Boolean);
  const base = q.get('base') || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const r = await fetch('/api/tudo', { headers: { 'X-Token': token } });
  if (!r.ok) { document.getElementById('explica').textContent = 'Não consegui ler os dados. Abra as etiquetas de novo pelo programa.'; return; }
  const dados = await r.json();
  const itens = [
    ...dados.filamentos.linhas.map((x) => ({ tipo: 'rolo', id: x.ID, nome: x.Cor, sub: `${x.Marca} · ${x.Material}`, hex: x.Hex })),
    ...dados.insumos.linhas.map((x) => ({ tipo: 'insumo', id: x.ID, nome: x.Item, sub: `${x.Categoria || ''}${x.Local ? ' · ' + x.Local : ''}` })),
  ].filter((x) => !ids.length || ids.includes(x.id));

  document.getElementById('explica').textContent = base
    ? `${itens.length} etiqueta(s). O QR abre o item no celular, na rede de casa (${base}). Corte nas linhas tracejadas.`
    : `${itens.length} etiqueta(s), sem QR: ligue o "Acesso pelo celular" no programa e abra as etiquetas de novo.`;
  if (base) {
    document.getElementById('aviso').innerHTML = '<div class="aviso">O QR leva o endereço do PC na rede de casa. Se o endereço do PC mudar (roteador), as etiquetas param de abrir: fixe o IP do PC no roteador ou imprima de novo. Guarde as etiquetas só em casa: quem escanear consegue mexer nos dados enquanto o acesso pelo celular estiver ligado.</div>';
  }

  const qrSvg = (texto) => {
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
  };

  document.getElementById('folha').innerHTML = itens.map((x) => {
    const url = base ? `${base}/?t=${encodeURIComponent(token)}#${x.tipo}=${encodeURIComponent(x.id)}` : '';
    return `<div class="etq">
      <div class="qr">${url ? qrSvg(url) : '<div class="sem">sem QR</div>'}</div>
      <div>
        <div class="id">${esc(x.id)}</div>
        <div class="nome">${x.hex ? `<span class="cor" style="background:${esc(x.hex)}"></span>` : ''}${esc(x.nome)}</div>
        <div class="sub">${esc(x.sub)}</div>
      </div>
    </div>`;
  }).join('');
})();
