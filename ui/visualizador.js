// Visualizador 3D (STL e 3MF) com a mesa de 260 × 260 mm da Kobra X, e gerador de miniaturas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

const MESA = 260;
const COR_MODELO = 0x4fdca0;
const PALETA = [0x4fdca0, 0xe2f3eb, 0x5fb3d6, 0xf2c200, 0xcf1b7b, 0xee7a1c];
export const VERSAO_MINIATURA = 'v2'; // muda quando o desenho das miniaturas muda (as antigas são refeitas)

async function baixar(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`não consegui ler o arquivo (${resp.status})`);
  return resp.arrayBuffer();
}

// cor muito escura (filamento preto) fica um cinza escuro só na tela, para a luz mostrar os detalhes.
// Devolve a claridade original (0 a 1, como a pessoa vê).
const auxCor = new THREE.Color();
function realcarCor(cor) {
  const hsl = {};
  cor.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.l < 0.32) cor.setHSL(hsl.h, hsl.s, 0.32 + hsl.l * 0.4, THREE.SRGBColorSpace);
  return hsl.l;
}

// ---------------------------------------------------------------- 3MF com peças em arquivos separados
// O Bambu Studio, o OrcaSlicer e o Anycubic Slicer salvam o 3MF com a extensão "production":
// o 3dmodel.model só tem componentes que apontam para 3D/Objects/*.model (p:path). O ThreeMFLoader
// do three.js não segue esses caminhos e quebra ("reading 'mesh'"); este leitor segue.
const ATRIB = (tag, nome) => { const m = tag.match(new RegExp('(?:^|\\s)' + nome + '="([^"]*)"')); return m ? m[1] : null; };

function matriz3mf(texto) {
  const m = new THREE.Matrix4();
  if (!texto) return m;
  const v = texto.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some(Number.isNaN)) return m;
  // 3MF: ponto como linha × matriz 4×3 (m00 m01 m02 / m10 m11 m12 / m20 m21 m22 / m30 m31 m32)
  m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  return m;
}

function lerObjetos(xml) {
  const objetos = {};
  const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let o;
  while ((o = re.exec(xml))) {
    const id = ATRIB(o[1], 'id');
    const corpo = o[2];
    const obj = { mesh: null, componentes: [] };
    const iv = corpo.indexOf('<vertices'), it = corpo.indexOf('<triangles');
    if (iv >= 0 && it >= 0) {
      const pos = [];
      const rv = /<vertex\b[^>]*?\bx="([^"]+)"[^>]*?\by="([^"]+)"[^>]*?\bz="([^"]+)"/g;
      rv.lastIndex = iv;
      const fimV = corpo.indexOf('</vertices>', iv);
      let v;
      while ((v = rv.exec(corpo)) && v.index < fimV) pos.push(+v[1], +v[2], +v[3]);
      const idx = [];
      const rt = /<triangle\b[^>]*?\bv1="(\d+)"[^>]*?\bv2="(\d+)"[^>]*?\bv3="(\d+)"/g;
      rt.lastIndex = it;
      let t;
      while ((t = rt.exec(corpo))) idx.push(+t[1], +t[2], +t[3]);
      obj.mesh = { pos, idx };
    }
    const rc = /<component\b([^>]*?)\/?>/g;
    let c;
    while ((c = rc.exec(corpo))) {
      obj.componentes.push({ caminho: ATRIB(c[1], 'p:path'), id: ATRIB(c[1], 'objectid'), m: matriz3mf(ATRIB(c[1], 'transform')) });
    }
    objetos[id] = obj;
  }
  return objetos;
}

function ler3mfComPartes(dados) {
  const zip = unzipSync(new Uint8Array(dados), { filter: (f) => /\.model$/i.test(f.name) || /_rels\/\.rels$/i.test(f.name) });
  const arquivos = {};
  for (const nome of Object.keys(zip)) arquivos['/' + nome.replace(/^\/+/, '')] = strFromU8(zip[nome]);
  let raiz = '/3D/3dmodel.model';
  const rels = arquivos['/_rels/.rels'];
  if (rels) { const m = rels.match(/Target="([^"]+\.model)"/i); if (m) raiz = '/' + m[1].replace(/^\/+/, ''); }
  if (!arquivos[raiz]) raiz = Object.keys(arquivos).find((n) => /\.model$/i.test(n));
  if (!raiz) throw new Error('o 3MF não tem modelo dentro');
  const cache = {};
  const objetosDe = (arq) => (cache[arq] ??= lerObjetos(arquivos[arq] || ''));

  const grupo = new THREE.Group();
  let partes = 0;
  const montar = (arq, id, matriz, nivel) => {
    if (nivel > 16) return;
    const obj = objetosDe(arq)[id];
    if (!obj) return;
    if (obj.mesh && obj.mesh.idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(obj.mesh.pos, 3));
      g.setIndex(obj.mesh.idx);
      g.applyMatrix4(matriz);
      g.computeVertexNormals();
      grupo.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff })));
      partes++;
    }
    for (const c of obj.componentes) {
      const destino = c.caminho ? '/' + c.caminho.replace(/^\/+/, '') : arq;
      montar(destino, c.id, matriz.clone().multiply(c.m), nivel + 1);
    }
  };
  const xmlRaiz = arquivos[raiz];
  const build = xmlRaiz.slice(xmlRaiz.indexOf('<build'));
  const ri = /<item\b([^>]*?)\/?>/g;
  let i;
  while ((i = ri.exec(build))) {
    if (ATRIB(i[1], 'printable') === '0') continue;
    const caminho = ATRIB(i[1], 'p:path');
    montar(caminho ? '/' + caminho.replace(/^\/+/, '') : raiz, ATRIB(i[1], 'objectid'), matriz3mf(ATRIB(i[1], 'transform')), 0);
  }
  if (!partes) throw new Error('não achei nenhuma malha no 3MF');
  return grupo;
}

function ler3mf(dados) {
  // se o modelo principal aponta para outros arquivos (p:path), vai direto ao leitor próprio
  // (o do three.js leria tudo, que pode ter dezenas de MB, só para quebrar no fim)
  let comPartes = false;
  try {
    const so = unzipSync(new Uint8Array(dados), { filter: (f) => /^\/?3D\/3dmodel\.model$/i.test(f.name) });
    const nome = Object.keys(so)[0];
    comPartes = !!nome && /p:path=/.test(strFromU8(so[nome]));
  } catch (e) { /* deixa o three.js tentar e dar o erro dele */ }
  if (comPartes) return ler3mfComPartes(dados);
  let objeto = null, erro = null;
  try { objeto = new ThreeMFLoader().parse(dados); } catch (e) { erro = e; }
  let malhas = 0;
  if (objeto) objeto.traverse((o) => { if (o.isMesh) malhas++; });
  if (malhas) return objeto;
  try { return ler3mfComPartes(dados); } catch (e2) { throw erro || e2; }
}

// lê o arquivo, dá cor às partes sem cor, deita na mesa (Z da impressora = Y do three) e mede
function montarModelo(dados, caminho) {
  let objeto;
  if (/\.stl$/i.test(caminho)) {
    const geo = new STLLoader().parse(dados);
    geo.computeVertexNormals();
    objeto = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COR_MODELO, roughness: 0.55, metalness: 0.02 }));
  } else {
    objeto = ler3mf(dados);
  }
  let partes = 0, triangulos = 0, somaClaridade = 0, nCores = 0;
  objeto.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    // 3MF costuma vir sem normais: sem elas a luz não sombreia e a peça fica toda preta
    const semNormais = !g.attributes.normal;
    triangulos += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const semCor = mats.every((m) => !m || !m.color || m.color.getHex() === 0xffffff);
    if (semCor && !g.attributes.color) {
      o.material = new THREE.MeshStandardMaterial({ color: PALETA[partes % PALETA.length], roughness: 0.55, metalness: 0.02,
        flatShading: semNormais, side: THREE.DoubleSide });
    } else {
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.DoubleSide;
        if (semNormais) m.flatShading = true;
        if (m.color && !(g.attributes.color && m.color.getHex() === 0xffffff)) { somaClaridade += realcarCor(m.color); nCores++; }
        m.needsUpdate = true;
      }
      const c = g.attributes.color;
      if (c) {
        let soma = 0;
        for (let i = 0; i < c.count; i++) {
          auxCor.setRGB(c.getX(i), c.getY(i), c.getZ(i));
          soma += realcarCor(auxCor);
          c.setXYZ(i, auxCor.r, auxCor.g, auxCor.b);
        }
        c.needsUpdate = true;
        somaClaridade += soma / Math.max(1, c.count);
        nCores++;
      }
    }
    partes++;
  });
  const grupo = new THREE.Group();
  grupo.add(objeto);
  grupo.rotation.x = -Math.PI / 2;
  grupo.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(grupo);
  const centro = caixa.getCenter(new THREE.Vector3());
  grupo.position.set(-centro.x, -caixa.min.y, -centro.z);
  const s = caixa.getSize(new THREE.Vector3());
  // peça escura (preta, cinza-chumbo…) aparece melhor em fundo claro
  const escuro = nCores > 0 && somaClaridade / nCores < 0.25;
  return { grupo, tam: { x: s.x, y: s.z, z: s.y }, partes, triangulos: Math.round(triangulos), escuro };
}

// cores do fundo escuro da prévia 3D por tema de cores (as miniaturas usam sempre o padrão)
const CENA_ESCURA = {
  pinho: { fundo: 0x0f2620, chao: 0x2a4a40, contorno: 0xbff5dc, placa: 0x123a2f, grade: 0x4fdca0, grade2: 0x1f4a3d },
  reggae: { fundo: 0x14140f, chao: 0x3a3626, contorno: 0xfff1c4, placa: 0x1e1d16, grade: 0xffd21f, grade2: 0x3a382a },
};
const temaDaTela = () => (typeof document !== 'undefined' && document.documentElement.dataset.tema) || 'pinho';

function montarCena(comMesa, claro = false, tema = 'pinho') {
  const e = CENA_ESCURA[tema] || CENA_ESCURA.pinho;
  const cena = new THREE.Scene();
  cena.background = new THREE.Color(claro ? 0xdfe8e3 : e.fundo);
  cena.add(new THREE.HemisphereLight(0xffffff, claro ? 0x8fa39a : e.chao, claro ? 1.25 : 1.15));
  const sol = new THREE.DirectionalLight(0xffffff, 1.7); // luz principal, da frente e de cima
  sol.position.set(180, 320, 220);
  cena.add(sol);
  const preenche = new THREE.DirectionalLight(0xffffff, 0.55); // clareia as sombras do outro lado
  preenche.position.set(-260, 140, 160);
  cena.add(preenche);
  const contorno = new THREE.DirectionalLight(claro ? 0xffffff : e.contorno, 1.1); // de trás: desenha o contorno
  contorno.position.set(-120, 220, -300);
  cena.add(contorno);
  if (comMesa) {
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(MESA, MESA),
      new THREE.MeshStandardMaterial({ color: claro ? 0xc9d6cf : e.placa, roughness: 0.95 }));
    placa.rotation.x = -Math.PI / 2;
    placa.position.y = -0.2;
    cena.add(placa);
    const grade = new THREE.GridHelper(MESA, 26, claro ? 0x2fb47e : e.grade, claro ? 0xa9bdb3 : e.grade2);
    grade.material.transparent = true;
    grade.material.opacity = 0.55;
    cena.add(grade);
  }
  return cena;
}

function liberar(cena) {
  cena.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

export async function mostrarModelo(container, url, caminho, aoInfo, opcoes = {}) {
  const { grupo, tam, partes, triangulos, escuro } = montarModelo(await baixar(url), caminho);
  let claro = opcoes.claro ?? escuro;
  let cena = montarCena(true, claro, temaDaTela());
  cena.add(grupo);

  const largura = container.clientWidth, altura = container.clientHeight;
  const camera = new THREE.PerspectiveCamera(38, largura / altura, 0.5, 6000);
  const raio = Math.max(tam.x, tam.y, tam.z, 60);
  camera.position.set(raio * 0.85, raio * 0.95, raio * 1.25);

  const render = new THREE.WebGLRenderer({ antialias: true });
  render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  render.setSize(largura, altura);
  container.innerHTML = '';
  container.appendChild(render.domElement);

  const controles = new OrbitControls(camera, render.domElement);
  controles.target.set(0, tam.z / 2, 0);
  controles.enableDamping = true;
  controles.update();

  let ativo = true;
  const laco = () => {
    if (!ativo) return;
    controles.update();
    render.render(cena, camera);
    requestAnimationFrame(laco);
  };
  laco();

  const redimensionar = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render.setSize(w, h);
  };
  window.addEventListener('resize', redimensionar);
  aoInfo({ ...tam, triangulos, partes, escuro, claro });

  return {
    get claro() { return claro; },
    alternarFundo() {
      claro = !claro;
      cena.remove(grupo);
      liberar(cena);
      cena = montarCena(true, claro, temaDaTela());
      cena.add(grupo);
      return claro;
    },
    destruir() {
      ativo = false;
      window.removeEventListener('resize', redimensionar);
      controles.dispose();
      cena.add(grupo);
      liberar(cena);
      render.dispose();
    },
  };
}

// ---------------------------------------------------------------- miniaturas
let renderMini = null;

export async function gerarMiniatura(url, caminho, lado = 320) {
  const { grupo, escuro } = montarModelo(await baixar(url), caminho);
  if (!renderMini) {
    renderMini = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderMini.setPixelRatio(1);
  }
  renderMini.setSize(lado, lado, false);
  const cena = montarCena(false, escuro);
  cena.add(grupo);
  // enquadra a peça inteira (esfera em volta dela), vista de cima e de lado
  const esfera = new THREE.Box3().setFromObject(grupo).getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20000);
  const direcao = new THREE.Vector3(1, 0.85, 1.3).normalize();
  const distancia = Math.max(esfera.radius, 1) / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04;
  camera.position.copy(esfera.center).addScaledVector(direcao, distancia);
  camera.near = distancia / 100;
  camera.far = distancia * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(esfera.center);
  renderMini.render(cena, camera);
  const png = renderMini.domElement.toDataURL('image/png');
  liberar(cena);
  return png;
}
