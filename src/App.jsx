import React from 'react';

const apiBaseUrl = "https://pousada-api.onrender.com";

function authHeaders(token) {
  return token ? { "Authorization": "Bearer " + token } : {};
}

// Máscara + validação real de CPF — achado real auditando a oficina como
// arquiteto sênior (2026-06-24): campo "cpf" era input de texto puro, sem
// máscara nem validação nenhuma. Algoritmo padrão de dígito verificador
// (não é só formato — rejeita CPF formatado certo mas matematicamente
// inválido, ex.: todos os dígitos iguais).
function formatarCPF(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function cpfValido(cpf) {
  const d = String(cpf || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0, resto;
  for (let i = 1; i <= 9; i++) soma += parseInt(d.substring(i - 1, i)) * (11 - i);
  resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(d.substring(9, 10))) return false;
  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(d.substring(i - 1, i)) * (12 - i);
  resto = (soma * 10) % 11; if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(d.substring(10, 11));
}
// Máscara de telefone (fixo 4+4 ou celular 5+4) — mesma auditoria.
function formatarTelefone(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, function(_, a, b, c) { return c ? "(" + a + ") " + b + "-" + c : (b ? "(" + a + ") " + b : "(" + a); });
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, function(_, a, b, c) { return c ? "(" + a + ") " + b + "-" + c : (b ? "(" + a + ") " + b : "(" + a); });
}

// Bug real (achado testando o timer de apontamento ao vivo, 2026-06-24):
// `new Date().toISOString()` grava em UTC, mas o backend guarda como
// LocalDateTime (sem fuso) e devolve o MESMO texto sem "Z" — quando o
// navegador relê esse texto sem "Z", o JS assume hora LOCAL, não UTC,
// gerando diferença de fuso inteira na conta de minutos (deu "-180min"
// no teste, exatamente o offset de Brasília). Mesma convenção que os
// outros campos de data do sistema já usam (datetime-local, sem fuso) —
// grava e relê hora local pura, sem conversão UTC no meio do caminho.
function agoraLocalISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

// Mapeia valor de status pra classe de cor — palavras comuns em
// português (não exaustivo, mas cobre o vocabulário típico de
// status/situação de pedido, ordem de serviço, pagamento, etc.).
function corStatus(valor) {
  const v = String(valor || "").toLowerCase();
  if (/conclu|finaliz|entreg|pago|aprovad|ativ|pront/.test(v)) return "status-ok";
  if (/pendente|aguardando|aberto|andamento|process|preparo|confirmad|envi|saiu|novo/.test(v)) return "status-warn";
  if (/atrasad|cancelad|rejeitad|negad|inativ/.test(v)) return "status-bad";
  return "status-neutral";
}

// Ícone pro KPI do dashboard — a chave vem de um dict genérico em tempo
// de execução ("totalCliente", "somaValorMaoObra"...), não dá pra saber
// no momento de gerar o template, por isso é JS, não Python.
function iconeMetrica(chave) {
  const k = chave.toLowerCase();
  if (/soma|valor|faturamento|receita|preco/.test(k)) return "💰";
  if (/comissao/.test(k)) return "🤝";
  if (/cliente|paciente|aluno/.test(k)) return "👤";
  if (/ordem|pedido|venda|processo/.test(k)) return "🧾";
  if (/veiculo|carro/.test(k)) return "🚗";
  if (/peca|produto|item|estoque/.test(k)) return "📦";
  if (/mecanico|funcionario|profissional|usuario/.test(k)) return "🧑‍🔧";
  return "📊";
}

// Upload de arquivo real — capacidade nova (2026-06-23, pedido real:
// "upload de boleto/nota fiscal/foto"). Sobe pro /api/upload (Base64 no
// Postgres, sem credencial de S3/MinIO) e devolve a URL pra salvar no
// campo do formulário.
// Bug real (achado testando ao vivo, checklist de vistoria 2026-06-24):
// /api/upload exige token igual qualquer outro endpoint em projeto com
// auth — esta função nunca mandava o header, todo upload (foto única OU
// múltipla, em QUALQUER projeto com auth habilitado) devolvia 401 sem
// nenhuma mensagem de erro visível pro usuário.
function uploadArquivo(file, aoConcluir, token) {
  if (!file) return;
  const dados = new FormData();
  dados.append("arquivo", file);
  fetch(apiBaseUrl + "/api/upload", { method: "POST", body: dados, headers: authHeaders(token) })
    .then(r => r.json())
    .then(d => { if (d.url) aoConcluir(d.url); })
    .catch(() => {});
}

// Leitor de código de barras pela câmera — capacidade nova (2026-06-23).
// BarcodeDetector é nativo do Chrome/Edge (zero biblioteca nova); em
// navegador sem suporte (Firefox/Safari), avisa em vez de travar.
function ScannerModal({ onDetectado, onClose }) {
  const videoRef = React.useRef(null);
  const [erro, setErro] = React.useState("");
  React.useEffect(() => {
    if (!("BarcodeDetector" in window)) {
      setErro("Esse navegador não suporta leitura de código de barras pela câmera. Use Chrome ou Edge, ou digite o código manualmente.");
      return;
    }
    let stream;
    let ativo = true;
    const detector = new window.BarcodeDetector();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(s => {
        stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
        const tick = () => {
          if (!ativo || !videoRef.current) return;
          detector.detect(videoRef.current).then(codigos => {
            if (codigos.length > 0) { onDetectado(codigos[0].rawValue); }
            else if (ativo) requestAnimationFrame(tick);
          }).catch(() => { if (ativo) requestAnimationFrame(tick); });
        };
        requestAnimationFrame(tick);
      })
      .catch(() => setErro("Não consegui acessar a câmera. Verifique a permissão do navegador."));
    return () => { ativo = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Escanear código de barras</h3>
        {erro ? <p className="login-erro">{erro}</p> : <video ref={videoRef} className="scanner-video" muted playsInline />}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [modo, setModo] = React.useState("login");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [erro, setErro] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  const enviar = (e) => {
    e.preventDefault();
    if (enviando) return;
    setErro("");
    setEnviando(true);
    fetch(apiBaseUrl + "/api/auth/" + (modo === "login" ? "login" : "registrar"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(r => r.json()).then(data => {
      setEnviando(false);
      if (data.token) { onLogin(data.token, data.role || "USER", data.username || ""); }
      else if (data.mensagem) { setModo("login"); setErro("Conta criada! Agora faça login."); }
      else { setErro(data.erro || "Não foi possível entrar."); }
    }).catch(() => { setEnviando(false); setErro("Erro de conexão com o servidor."); });
  };

  return (
    <div className="login-screen">
      <div className="login-institucional">
        <div className="login-tema-icone">💼</div>
        <h1>Pousada</h1>
        <p className="login-slogan">Gestão profissional</p>
        <div className="login-quemsomos">
          <h3>Quem somos</h3>
          <p>Sistema de gestão profissional, com controle de acesso por usuário e dado protegido.</p>
        </div>
        <ul className="login-features">
          <li>✓ Controle completo de Acomodacao</li>
          <li>✓ Controle completo de Hospede</li>
          <li>✓ Controle completo de Reserva</li>
          <li>✓ Controle completo de Consumo</li>
        </ul>
      </div>
      <div className="login-card">
        <h1>{modo === "login" ? "Entrar" : "Criar conta"}</h1>
        <p className="login-sub">{modo === "login" ? "Acesse sua conta pra continuar" : "Preencha os dados pra começar"}</p>
        <form onSubmit={enviar}>
          <input placeholder="Usuário" value={username} onChange={e => setUsername(e.target.value)} />
          <input placeholder="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={enviando}>{enviando ? "Aguarde..." : (modo === "login" ? "Entrar" : "Criar conta")}</button>
        </form>
        {erro && <p className="login-erro">{erro}</p>}
        <button className="link-btn" onClick={() => setModo(modo === "login" ? "registrar" : "login")}>
          {modo === "login" ? "Ainda não tenho conta" : "Já tenho conta"}
        </button>
      </div>
    </div>
  );
}

// Gráfico de barras simples (CSS, sem biblioteca) — capacidade nova
// (2026-06-23, pedido real: "dashboard com graficos mostrando fluxo de
// caixa"). Cada chave "graficoXxx" do /api/dashboard/resumo é um
// Map<String,Long> (contagem por status) — vira barra colorida com
// corStatus(), mesma paleta usada no pill de status dos cards.
function GraficoBarras({ titulo, dados }) {
  const entradas = Object.entries(dados);
  const max = Math.max(1, ...entradas.map(([, v]) => v));
  return (
    <div className="dash-card dash-card-grafico">
      <div className="dash-grafico-titulo">{titulo.replace(/([A-Z])/g, " $1").trim()}</div>
      {entradas.map(([label, valor]) => (
        <div className="dash-grafico-linha" key={label}>
          <span className="dash-grafico-label">{label}</span>
          <div className="dash-grafico-barra-wrap">
            <div className={"dash-grafico-barra " + corStatus(label)} style={{ width: (valor / max * 100) + "%" }}></div>
          </div>
          <span className="dash-grafico-valor">{valor}</span>
        </div>
      ))}
    </div>
  );
}

// Gráfico de pizza/donut (CSS conic-gradient, sem biblioteca) — pedido
// real (2026-06-24, auditoria sênior): "relatório também por pizza, barra
// redonda, consegue acompanhar o fluxo das ordens". Mesma fonte de dado
// do GraficoBarras (Map<String,Long> de /api/dashboard/resumo) — mostra
// os dois lado a lado, cada um lê melhor um aspecto (barra = comparar
// volume, pizza = ver proporção do todo).
function _corStatusHex(label) {
  const c = corStatus(label);
  return c === "status-ok" ? "#6ee7a8" : c === "status-warn" ? "#fbbf24" : c === "status-bad" ? "var(--accent3)" : "var(--accent1)";
}
function GraficoPizza({ titulo, dados }) {
  const entradas = Object.entries(dados);
  const total = entradas.reduce((s, [, v]) => s + v, 0) || 1;
  let acumulado = 0;
  const fatias = entradas.map(([label, valor]) => {
    const inicio = (acumulado / total) * 360;
    acumulado += valor;
    const fim = (acumulado / total) * 360;
    return _corStatusHex(label) + " " + inicio + "deg " + fim + "deg";
  });
  return (
    <div className="dash-card dash-card-grafico">
      <div className="dash-grafico-titulo">{titulo.replace(/([A-Z])/g, " $1").trim()}</div>
      <div className="grafico-pizza-wrap">
        <div className="grafico-pizza" style={{ background: "conic-gradient(" + fatias.join(", ") + ")" }}></div>
        <div className="grafico-pizza-legenda">
          {entradas.map(([label, valor]) => (
            <div key={label}><span className="legenda-dot" style={{ background: _corStatusHex(label) }}></span>{label}: {valor}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardResumo({ token }) {
  const [resumo, setResumo] = React.useState(null);
  React.useEffect(() => {
    fetch(apiBaseUrl + "/api/dashboard/resumo", { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : null).then(setResumo).catch(() => setResumo(null));
  }, [token]);
  if (!resumo) return null;
  const numericas = Object.entries(resumo).filter(([, v]) => typeof v !== "object" || v === null);
  const graficos = Object.entries(resumo).filter(([, v]) => typeof v === "object" && v !== null);
  return (
    <div>
      <div className="dash-grid">
        {numericas.map(([k, v]) => (
          <div className="dash-card" key={k}>
            <div className="dash-ico">{iconeMetrica(k)}</div>
            <div>
              <span className="dash-num">{typeof v === "number" ? v.toLocaleString("pt-BR") : String(v)}</span>
              <span className="dash-label">{k.replace(/([A-Z])/g, " $1").trim()}</span>
            </div>
          </div>
        ))}
      </div>
      {graficos.length > 0 && (
        <div className="dash-grid dash-grid-graficos">
          {graficos.map(([k, v]) => (
            <React.Fragment key={k}>
              <GraficoBarras titulo={k} dados={v} />
              <GraficoPizza titulo={k} dados={v} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}


function PixModal({ valor, token, onClose }) {
  const [resultado, setResultado] = React.useState(null);
  const [erro, setErro] = React.useState("");
  React.useEffect(() => {
    fetch(apiBaseUrl + "/api/pix/gerar", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ valor }),
    }).then(r => r.json()).then(d => {
      if (d.qrCodeBase64) setResultado(d); else setErro("Não foi possível gerar o Pix.");
    }).catch(() => setErro("Erro de conexão."));
  }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Cobrança via Pix — R$ {Number(valor || 0).toFixed(2)}</h3>
        {erro && <p className="login-erro">{erro}</p>}
        {resultado && (
          <>
            <img className="pix-qr" src={resultado.qrCodeBase64} alt="QR Code Pix" />
            <div className="pix-code">{resultado.payload}</div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function PainelAcomodacao({ token, apiBaseUrl, onPix, role, onLogout }) {
  const [itens, setItens] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [form, setForm] = React.useState({});
  const [editId, setEditId] = React.useState(null);
  const [modalAberto, setModalAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(1);
  const [modoKanban, setModoKanban] = React.useState(false);
  const [hospedeList, setHospedeList] = React.useState([]);
  const [consumoList, setConsumoList] = React.useState([]);

  // Paginação real (achado real auditando como cliente exigente: lista sem
  // limite nenhum, "queria ver pelo menos os 10 primeiros"). Front-end só —
  // não muda o contrato da API (que os outros 9 projetos já usam tal como
  // está), só corta o que já foi carregado em páginas de 10.
  const itensFiltrados = itens.filter(item => !busca || ["nome", "tipo", "capacidade", "camas", "precoDiaria", "comodidades", "status", "id"].some(k => String(item[k] ?? "").toLowerCase().includes(busca.toLowerCase())));
  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / 10));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const itensPagina = itensFiltrados.slice((paginaAtual - 1) * 10, paginaAtual * 10);

  const carregar = () => fetch(apiBaseUrl + "/api/acomodacaos", { headers: authHeaders(token) })
    .then(r => { if (r.status === 401) { onLogout && onLogout(); return []; } return r.json(); })
    .then(data => { if (Array.isArray(data)) setItens(data); })
    .catch(() => setItens([]))
    .finally(() => setCarregando(false));

  React.useEffect(() => {
    carregar();
    fetch(apiBaseUrl + "/api/hospedes", { headers: authHeaders(token) }).then(r => r.json()).then(setHospedeList).catch(() => {});
    fetch(apiBaseUrl + "/api/consumos", { headers: authHeaders(token) }).then(r => r.json()).then(setConsumoList).catch(() => {});
  }, [token]);

  // Bug GRAVE achado real (2026-06-24, testando o formulário de verdade
  // pelo navegador, não só por API): mandava {cliente: {id: 5}} pro
  // backend, mas o RequestDTO espera "clienteId": 5 (chave plana) — TODO
  // formulário com relacionamento (dropdown) falhava 400 silenciosamente
  // (sem .catch, o modal fechava como se tivesse dado certo). Afetava
  // TODOS os 10 projetos, qualquer entidade com relacionamento.
  const montarCorpo = () => {
    const corpo = { ...form };
    ["hospede", "consumo"].forEach(k => {
      corpo[k + "Id"] = corpo[k] ? Number(corpo[k]) : null;
      delete corpo[k];
    });
    // Bug real (2026-06-26): <input type="datetime-local"> envia "YYYY-MM-DDTHH:mm"
    // sem segundos, mas LocalDateTime precisa de "YYYY-MM-DDTHH:mm:ss" — Jackson
    // rejeita o formato curto com 400. Normaliza para ISO completo antes de enviar.
    Object.keys(corpo).forEach(k => {
      if (typeof corpo[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(corpo[k]))
        corpo[k] = corpo[k] + ':00';
    });
    return corpo;
  };

  const [erroSalvar, setErroSalvar] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const salvar = (e) => {
    e.preventDefault();
    if (salvando) return;
    setErroSalvar("");
    setSalvando(true);
    const url = editId ? apiBaseUrl + "/api/acomodacaos/" + editId : apiBaseUrl + "/api/acomodacaos";
    fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(montarCorpo()),
    }).then(async r => {
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        const msg = corpo.erros ? Object.entries(corpo.erros).map(([k, v]) => k + ": " + v).join("; ") : (corpo.erro || "Erro ao salvar.");
        throw new Error(msg);
      }
      return carregar();
    }).then(() => { setSalvando(false); setForm({}); setEditId(null); setModalAberto(false); })
      .catch(err => { setSalvando(false); setErroSalvar(err.message); });
  };

  const editar = (item) => {
    const f = {};
    ["nome", "tipo", "capacidade", "camas", "precoDiaria", "comodidades", "status"].forEach(k => { f[k] = item[k] ?? ""; });
    ["hospede", "consumo"].forEach(k => { f[k] = item[k + "Id"] ?? ""; });
    setErroSalvar(""); setForm(f); setEditId(item.id); setModalAberto(true);
  };

  const apagar = (id) => fetch(apiBaseUrl + "/api/acomodacaos/" + id, { method: "DELETE", headers: authHeaders(token) })
    .then(async r => {
      if (r.status === 401) { onLogout && onLogout(); return; }
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        alert("Erro ao excluir: " + (corpo.erro || corpo.mensagem || "Verifique se não há registros vinculados."));
        return;
      }
      carregar();
    })
    .catch(err => alert("Erro ao excluir: " + err.message));

  const gerarPix = (valor) => onPix(valor);

  return (
    <div>
      <div className="panel-header">
        <h2>Acomodacao</h2>
        <div className="panel-header-right">
          <div className="search-wrap">
            <span className="search-ico">🔎</span>
            <input className="search-input" placeholder="Buscar..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setModoKanban(m => !m)}>{modoKanban ? "Ver lista" : "Ver Kanban"}</button>
          <button className="btn btn-primary" onClick={() => { setForm({}); setEditId(null); setErroSalvar(""); setModalAberto(true); }}>+ Novo</button>
        </div>
      </div>

      {carregando && <div className="empty-state">Carregando...</div>}
      {!carregando && itens.length === 0 && <div className="empty-state">Nenhum registro ainda. Clique em "+ Novo" pra criar o primeiro.</div>}
      {!carregando && itens.length > 0 && itensFiltrados.length === 0 && <div className="empty-state">Nenhum resultado para a busca "{"}}busca{{"}".</div>}

      {modoKanban && (
        <div className="kanban-board">
          {[...new Set(itensFiltrados.map(i => String(i.status ?? "Sem status")))].map(coluna => (
            <div className="kanban-coluna" key={coluna}>
              <div className="kanban-coluna-titulo">
                <span className={"status-pill " + corStatus(coluna)}>{coluna}</span>
                <span className="kanban-coluna-contagem">{itensFiltrados.filter(i => String(i.status ?? "Sem status") === coluna).length}</span>
              </div>
              {itensFiltrados.filter(i => String(i.status ?? "Sem status") === coluna).map(item => (
                <div className="kanban-card" key={item.id}>
                  <div className="kanban-card-titulo">{String(item["nome"] ?? "Acomodacao")}</div>
                  <select className="kanban-select" value={item.status ?? ""} onChange={e => {
                    fetch(apiBaseUrl + "/api/acomodacaos/" + item.id, {
                      method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders(token) },
                      body: JSON.stringify({ ...item, status: e.target.value }),
                    }).then(carregar);
                  }}>
                    {[...new Set(itensFiltrados.map(i => String(i.status ?? "Sem status")))].map(s => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!modoKanban && <><div className="items-grid">
        {itensPagina.map(item => (
          <div className="item-card" key={item.id}>
            
            <div className="item-card-header">
              <div className="item-icon-badge">🗂️</div>
              <span className="item-id-tag">#{item.id}</span>
            </div>
            <div className="item-title">{String(item["nome"] ?? "Acomodacao")}</div>
            <span className={"status-pill " + corStatus(item.status)}>{String(item.status ?? "")}</span>
            <div className="item-meta-grid">
            <div className="item-field"><b>tipo</b><span>{item["tipo"] ?? "—"}</span></div>
            <div className="item-field"><b>capacidade</b><span>{item["capacidade"] ?? "—"}</span></div>
            <div className="item-field"><b>camas</b><span>{item["camas"] ?? "—"}</span></div>
            <div className="item-field"><b>precoDiaria</b><span>{item["precoDiaria"] != null ? Number(item["precoDiaria"]).toLocaleString("pt-BR", {style:"currency",currency:"BRL"}) : "—"}</span></div>
            <div className="item-field"><b>comodidades</b><span>{item["comodidades"] ?? "—"}</span></div>
            <div className="item-field"><b>hospede</b><span>{item.hospedeId ? ((hospedeList.find(o => o.id === item.hospedeId) || {}).nome ?? ("#" + item.hospedeId)) : "—"}</span></div>
            <div className="item-field"><b>consumo</b><span>{item.consumoId ? ((consumoList.find(o => o.id === item.consumoId) || {}).descricao ?? ("#" + item.consumoId)) : "—"}</span></div>
            </div>
            <div className="item-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => editar(item)}>Editar</button>
              {role === "ADMIN" && <button className="btn btn-danger btn-sm" onClick={() => { if(window.confirm("Confirmar exclusão?")) apagar(item.id); }}>Apagar</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => gerarPix(item.precoDiaria)}>Cobrar via Pix</button>
              
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
          <span className="pagination-info">Página {paginaAtual} de {totalPaginas} ({itensFiltrados.length} no total)</span>
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima →</button>
        </div>
      )}</>}

      {modalAberto && (
        <div className="modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editId ? "Editar" : "Novo"} Acomodacao</h3>
            {erroSalvar && <div className="campo-erro modal-erro">{erroSalvar}</div>}
            <form onSubmit={salvar}>
              <label className="field-label">nome</label>
      <input type="text" value={form["nome"] ?? ""} onChange={e => setForm({...form, nome: e.target.value})} />
      <label className="field-label">tipo</label>
      <input type="text" value={form["tipo"] ?? ""} onChange={e => setForm({...form, tipo: e.target.value})} />
      <label className="field-label">capacidade</label>
      <input type="number" value={form["capacidade"] ?? ""} onChange={e => setForm({...form, capacidade: e.target.value})} />
      <label className="field-label">camas</label>
      <input type="number" value={form["camas"] ?? ""} onChange={e => setForm({...form, camas: e.target.value})} />
      <label className="field-label">precoDiaria</label>
      <input type="number" step="0.01" value={form["precoDiaria"] ?? ""} onChange={e => setForm({...form, precoDiaria: e.target.value})} />
      <label className="field-label">comodidades</label>
      <input type="text" value={form["comodidades"] ?? ""} onChange={e => setForm({...form, comodidades: e.target.value})} />
      <label className="field-label">status</label>
      <select value={form["status"] ?? "ATIVO"} onChange={e => setForm({...form, status: e.target.value})}>
        <option value="ATIVO">ATIVO</option>
        <option value="PENDENTE">PENDENTE</option>
        <option value="CONCLUIDO">CONCLUIDO</option>
        <option value="CANCELADO">CANCELADO</option>
        <option value="INATIVO">INATIVO</option>
      </select>
      <label className="field-label">hospede</label>
      <select value={form["hospede"] ?? ""} onChange={e => setForm({...form, hospede: e.target.value})}>
        <option value="">Selecione...</option>
        {(hospedeList || []).map(o => (<option key={o.id} value={o.id}>{o.nome ?? ("#" + o.id)}</option>))}
      </select>
      <label className="field-label">consumo</label>
      <select value={form["consumo"] ?? ""} onChange={e => setForm({...form, consumo: e.target.value})}>
        <option value="">Selecione...</option>
        {(consumoList || []).map(o => (<option key={o.id} value={o.id}>{o.descricao ?? ("#" + o.id)}</option>))}
      </select>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PainelHospede({ token, apiBaseUrl, onPix, role, onLogout }) {
  const [itens, setItens] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [form, setForm] = React.useState({});
  const [editId, setEditId] = React.useState(null);
  const [modalAberto, setModalAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(1);
  const [cpfErro, setCpfErro] = React.useState(false);
  

  // Paginação real (achado real auditando como cliente exigente: lista sem
  // limite nenhum, "queria ver pelo menos os 10 primeiros"). Front-end só —
  // não muda o contrato da API (que os outros 9 projetos já usam tal como
  // está), só corta o que já foi carregado em páginas de 10.
  const itensFiltrados = itens.filter(item => !busca || ["nome", "cpf", "email", "telefone", "cidade", "estado", "origem", "id"].some(k => String(item[k] ?? "").toLowerCase().includes(busca.toLowerCase())));
  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / 10));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const itensPagina = itensFiltrados.slice((paginaAtual - 1) * 10, paginaAtual * 10);

  const carregar = () => fetch(apiBaseUrl + "/api/hospedes", { headers: authHeaders(token) })
    .then(r => { if (r.status === 401) { onLogout && onLogout(); return []; } return r.json(); })
    .then(data => { if (Array.isArray(data)) setItens(data); })
    .catch(() => setItens([]))
    .finally(() => setCarregando(false));

  React.useEffect(() => {
    carregar();
    
  }, [token]);

  // Bug GRAVE achado real (2026-06-24, testando o formulário de verdade
  // pelo navegador, não só por API): mandava {cliente: {id: 5}} pro
  // backend, mas o RequestDTO espera "clienteId": 5 (chave plana) — TODO
  // formulário com relacionamento (dropdown) falhava 400 silenciosamente
  // (sem .catch, o modal fechava como se tivesse dado certo). Afetava
  // TODOS os 10 projetos, qualquer entidade com relacionamento.
  const montarCorpo = () => {
    const corpo = { ...form };
    [].forEach(k => {
      corpo[k + "Id"] = corpo[k] ? Number(corpo[k]) : null;
      delete corpo[k];
    });
    // Bug real (2026-06-26): <input type="datetime-local"> envia "YYYY-MM-DDTHH:mm"
    // sem segundos, mas LocalDateTime precisa de "YYYY-MM-DDTHH:mm:ss" — Jackson
    // rejeita o formato curto com 400. Normaliza para ISO completo antes de enviar.
    Object.keys(corpo).forEach(k => {
      if (typeof corpo[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(corpo[k]))
        corpo[k] = corpo[k] + ':00';
    });
    return corpo;
  };

  const [erroSalvar, setErroSalvar] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const salvar = (e) => {
    e.preventDefault();
    if (salvando) return;
    setErroSalvar("");
    setSalvando(true);
    const url = editId ? apiBaseUrl + "/api/hospedes/" + editId : apiBaseUrl + "/api/hospedes";
    fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(montarCorpo()),
    }).then(async r => {
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        const msg = corpo.erros ? Object.entries(corpo.erros).map(([k, v]) => k + ": " + v).join("; ") : (corpo.erro || "Erro ao salvar.");
        throw new Error(msg);
      }
      return carregar();
    }).then(() => { setSalvando(false); setForm({}); setEditId(null); setModalAberto(false); })
      .catch(err => { setSalvando(false); setErroSalvar(err.message); });
  };

  const editar = (item) => {
    const f = {};
    ["nome", "cpf", "email", "telefone", "cidade", "estado", "origem"].forEach(k => { f[k] = item[k] ?? ""; });
    [].forEach(k => { f[k] = item[k + "Id"] ?? ""; });
    setErroSalvar(""); setForm(f); setEditId(item.id); setModalAberto(true);
  };

  const apagar = (id) => fetch(apiBaseUrl + "/api/hospedes/" + id, { method: "DELETE", headers: authHeaders(token) })
    .then(async r => {
      if (r.status === 401) { onLogout && onLogout(); return; }
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        alert("Erro ao excluir: " + (corpo.erro || corpo.mensagem || "Verifique se não há registros vinculados."));
        return;
      }
      carregar();
    })
    .catch(err => alert("Erro ao excluir: " + err.message));

  const gerarPix = (valor) => onPix(valor);

  return (
    <div>
      <div className="panel-header">
        <h2>Hospede</h2>
        <div className="panel-header-right">
          <div className="search-wrap">
            <span className="search-ico">🔎</span>
            <input className="search-input" placeholder="Buscar..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          
          <button className="btn btn-primary" onClick={() => { setForm({}); setEditId(null); setErroSalvar(""); setModalAberto(true); }}>+ Novo</button>
        </div>
      </div>

      {carregando && <div className="empty-state">Carregando...</div>}
      {!carregando && itens.length === 0 && <div className="empty-state">Nenhum registro ainda. Clique em "+ Novo" pra criar o primeiro.</div>}
      {!carregando && itens.length > 0 && itensFiltrados.length === 0 && <div className="empty-state">Nenhum resultado para a busca "{"}}busca{{"}".</div>}

      {true && <><div className="items-grid">
        {itensPagina.map(item => (
          <div className="item-card" key={item.id}>
            
            <div className="item-card-header">
              <div className="item-icon-badge">🗂️</div>
              <span className="item-id-tag">#{item.id}</span>
            </div>
            <div className="item-title">{String(item["nome"] ?? "Hospede")}</div>
            
            <div className="item-meta-grid">
            <div className="item-field"><b>cpf</b><span>{item["cpf"] ?? "—"}</span></div>
            <div className="item-field"><b>email</b><span>{item["email"] ?? "—"}</span></div>
            <div className="item-field"><b>telefone</b><span>{item["telefone"] ?? "—"}</span></div>
            <div className="item-field"><b>cidade</b><span>{item["cidade"] ?? "—"}</span></div>
            <div className="item-field"><b>estado</b><span>{item["estado"] ?? "—"}</span></div>
            <div className="item-field"><b>origem</b><span>{item["origem"] ?? "—"}</span></div>
            
            </div>
            <div className="item-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => editar(item)}>Editar</button>
              {role === "ADMIN" && <button className="btn btn-danger btn-sm" onClick={() => { if(window.confirm("Confirmar exclusão?")) apagar(item.id); }}>Apagar</button>}
              
              
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
          <span className="pagination-info">Página {paginaAtual} de {totalPaginas} ({itensFiltrados.length} no total)</span>
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima →</button>
        </div>
      )}</>}

      {modalAberto && (
        <div className="modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editId ? "Editar" : "Novo"} Hospede</h3>
            {erroSalvar && <div className="campo-erro modal-erro">{erroSalvar}</div>}
            <form onSubmit={salvar}>
              <label className="field-label">nome</label>
      <input type="text" value={form["nome"] ?? ""} onChange={e => setForm({...form, nome: e.target.value})} />
      <label className="field-label">cpf</label>
      <input type="text" maxLength={14} value={form["cpf"] ?? ""} className={cpfErro ? "input-invalido" : ""} onChange={e => setForm({...form, cpf: formatarCPF(e.target.value)})} onBlur={e => setCpfErro(!!e.target.value && !cpfValido(e.target.value))} />
      {cpfErro && <span className="campo-erro">CPF inválido</span>}
      <label className="field-label">email</label>
      <input type="text" value={form["email"] ?? ""} onChange={e => setForm({...form, email: e.target.value})} />
      <label className="field-label">telefone</label>
      <input type="text" maxLength={15} value={form["telefone"] ?? ""} onChange={e => setForm({...form, telefone: formatarTelefone(e.target.value)})} />
      <label className="field-label">cidade</label>
      <input type="text" value={form["cidade"] ?? ""} onChange={e => setForm({...form, cidade: e.target.value})} />
      <label className="field-label">estado</label>
      <input type="text" value={form["estado"] ?? ""} onChange={e => setForm({...form, estado: e.target.value})} />
      <label className="field-label">origem</label>
      <input type="text" value={form["origem"] ?? ""} onChange={e => setForm({...form, origem: e.target.value})} />
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PainelReserva({ token, apiBaseUrl, onPix, role, onLogout }) {
  const [itens, setItens] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [form, setForm] = React.useState({});
  const [editId, setEditId] = React.useState(null);
  const [modalAberto, setModalAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(1);
  const [modoKanban, setModoKanban] = React.useState(false);
  const [hospedeList, setHospedeList] = React.useState([]);
  const [acomodacaoList, setAcomodacaoList] = React.useState([]);

  // Paginação real (achado real auditando como cliente exigente: lista sem
  // limite nenhum, "queria ver pelo menos os 10 primeiros"). Front-end só —
  // não muda o contrato da API (que os outros 9 projetos já usam tal como
  // está), só corta o que já foi carregado em páginas de 10.
  const itensFiltrados = itens.filter(item => !busca || ["acomodacaoId", "hospedeId", "checkIn", "checkOut", "totalNoites", "valorTotal", "cafeDaManha", "status", "id"].some(k => String(item[k] ?? "").toLowerCase().includes(busca.toLowerCase())));
  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / 10));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const itensPagina = itensFiltrados.slice((paginaAtual - 1) * 10, paginaAtual * 10);

  const carregar = () => fetch(apiBaseUrl + "/api/reservas", { headers: authHeaders(token) })
    .then(r => { if (r.status === 401) { onLogout && onLogout(); return []; } return r.json(); })
    .then(data => { if (Array.isArray(data)) setItens(data); })
    .catch(() => setItens([]))
    .finally(() => setCarregando(false));

  React.useEffect(() => {
    carregar();
    fetch(apiBaseUrl + "/api/hospedes", { headers: authHeaders(token) }).then(r => r.json()).then(setHospedeList).catch(() => {});
    fetch(apiBaseUrl + "/api/acomodacaos", { headers: authHeaders(token) }).then(r => r.json()).then(setAcomodacaoList).catch(() => {});
  }, [token]);

  // Bug GRAVE achado real (2026-06-24, testando o formulário de verdade
  // pelo navegador, não só por API): mandava {cliente: {id: 5}} pro
  // backend, mas o RequestDTO espera "clienteId": 5 (chave plana) — TODO
  // formulário com relacionamento (dropdown) falhava 400 silenciosamente
  // (sem .catch, o modal fechava como se tivesse dado certo). Afetava
  // TODOS os 10 projetos, qualquer entidade com relacionamento.
  const montarCorpo = () => {
    const corpo = { ...form };
    ["acomodacao", "hospede"].forEach(k => {
      corpo[k + "Id"] = corpo[k] ? Number(corpo[k]) : null;
      delete corpo[k];
    });
    // Bug real (2026-06-26): <input type="datetime-local"> envia "YYYY-MM-DDTHH:mm"
    // sem segundos, mas LocalDateTime precisa de "YYYY-MM-DDTHH:mm:ss" — Jackson
    // rejeita o formato curto com 400. Normaliza para ISO completo antes de enviar.
    Object.keys(corpo).forEach(k => {
      if (typeof corpo[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(corpo[k]))
        corpo[k] = corpo[k] + ':00';
    });
    return corpo;
  };

  const [erroSalvar, setErroSalvar] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const salvar = (e) => {
    e.preventDefault();
    if (salvando) return;
    setErroSalvar("");
    setSalvando(true);
    const url = editId ? apiBaseUrl + "/api/reservas/" + editId : apiBaseUrl + "/api/reservas";
    fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(montarCorpo()),
    }).then(async r => {
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        const msg = corpo.erros ? Object.entries(corpo.erros).map(([k, v]) => k + ": " + v).join("; ") : (corpo.erro || "Erro ao salvar.");
        throw new Error(msg);
      }
      return carregar();
    }).then(() => { setSalvando(false); setForm({}); setEditId(null); setModalAberto(false); })
      .catch(err => { setSalvando(false); setErroSalvar(err.message); });
  };

  const editar = (item) => {
    const f = {};
    ["acomodacaoId", "hospedeId", "checkIn", "checkOut", "totalNoites", "valorTotal", "cafeDaManha", "status"].forEach(k => { f[k] = item[k] ?? ""; });
    ["acomodacao", "hospede"].forEach(k => { f[k] = item[k + "Id"] ?? ""; });
    setErroSalvar(""); setForm(f); setEditId(item.id); setModalAberto(true);
  };

  const apagar = (id) => fetch(apiBaseUrl + "/api/reservas/" + id, { method: "DELETE", headers: authHeaders(token) })
    .then(async r => {
      if (r.status === 401) { onLogout && onLogout(); return; }
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        alert("Erro ao excluir: " + (corpo.erro || corpo.mensagem || "Verifique se não há registros vinculados."));
        return;
      }
      carregar();
    })
    .catch(err => alert("Erro ao excluir: " + err.message));

  const gerarPix = (valor) => onPix(valor);

  return (
    <div>
      <div className="panel-header">
        <h2>Reserva</h2>
        <div className="panel-header-right">
          <div className="search-wrap">
            <span className="search-ico">🔎</span>
            <input className="search-input" placeholder="Buscar..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setModoKanban(m => !m)}>{modoKanban ? "Ver lista" : "Ver Kanban"}</button>
          <button className="btn btn-primary" onClick={() => { setForm({}); setEditId(null); setErroSalvar(""); setModalAberto(true); }}>+ Novo</button>
        </div>
      </div>

      {carregando && <div className="empty-state">Carregando...</div>}
      {!carregando && itens.length === 0 && <div className="empty-state">Nenhum registro ainda. Clique em "+ Novo" pra criar o primeiro.</div>}
      {!carregando && itens.length > 0 && itensFiltrados.length === 0 && <div className="empty-state">Nenhum resultado para a busca "{"}}busca{{"}".</div>}

      {modoKanban && (
        <div className="kanban-board">
          {[...new Set(itensFiltrados.map(i => String(i.status ?? "Sem status")))].map(coluna => (
            <div className="kanban-coluna" key={coluna}>
              <div className="kanban-coluna-titulo">
                <span className={"status-pill " + corStatus(coluna)}>{coluna}</span>
                <span className="kanban-coluna-contagem">{itensFiltrados.filter(i => String(i.status ?? "Sem status") === coluna).length}</span>
              </div>
              {itensFiltrados.filter(i => String(i.status ?? "Sem status") === coluna).map(item => (
                <div className="kanban-card" key={item.id}>
                  <div className="kanban-card-titulo">{String(item["status"] ?? "Reserva")}</div>
                  <select className="kanban-select" value={item.status ?? ""} onChange={e => {
                    fetch(apiBaseUrl + "/api/reservas/" + item.id, {
                      method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders(token) },
                      body: JSON.stringify({ ...item, status: e.target.value }),
                    }).then(carregar);
                  }}>
                    {[...new Set(itensFiltrados.map(i => String(i.status ?? "Sem status")))].map(s => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!modoKanban && <><div className="items-grid">
        {itensPagina.map(item => (
          <div className="item-card" key={item.id}>
            
            <div className="item-card-header">
              <div className="item-icon-badge">🗂️</div>
              <span className="item-id-tag">#{item.id}</span>
            </div>
            <div className="item-title">{String(item["status"] ?? "Reserva")}</div>
            <span className={"status-pill " + corStatus(item.status)}>{String(item.status ?? "")}</span>
            <div className="item-meta-grid">
            <div className="item-field"><b>acomodacaoId</b><span>{item["acomodacaoId"] ?? "—"}</span></div>
            <div className="item-field"><b>hospedeId</b><span>{item["hospedeId"] ?? "—"}</span></div>
            <div className="item-field"><b>checkIn</b><span>{item["checkIn"] ? new Date(item["checkIn"]).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"}) : "—"}</span></div>
            <div className="item-field"><b>checkOut</b><span>{item["checkOut"] ? new Date(item["checkOut"]).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"}) : "—"}</span></div>
            <div className="item-field"><b>totalNoites</b><span>{item["totalNoites"] ?? "—"}</span></div>
            <div className="item-field"><b>valorTotal</b><span>{item["valorTotal"] != null ? Number(item["valorTotal"]).toLocaleString("pt-BR", {style:"currency",currency:"BRL"}) : "—"}</span></div>
            <div className="item-field"><b>cafeDaManha</b><span>{item["cafeDaManha"] != null ? (item["cafeDaManha"] ? "Sim" : "Não") : "—"}</span></div>
            <div className="item-field"><b>acomodacao</b><span>{item.acomodacaoId ? ((acomodacaoList.find(o => o.id === item.acomodacaoId) || {}).nome ?? ("#" + item.acomodacaoId)) : "—"}</span></div>
            <div className="item-field"><b>hospede</b><span>{item.hospedeId ? ((hospedeList.find(o => o.id === item.hospedeId) || {}).nome ?? ("#" + item.hospedeId)) : "—"}</span></div>
            </div>
            <div className="item-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => editar(item)}>Editar</button>
              {role === "ADMIN" && <button className="btn btn-danger btn-sm" onClick={() => { if(window.confirm("Confirmar exclusão?")) apagar(item.id); }}>Apagar</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => gerarPix(item.valorTotal)}>Cobrar via Pix</button>
              
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
          <span className="pagination-info">Página {paginaAtual} de {totalPaginas} ({itensFiltrados.length} no total)</span>
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima →</button>
        </div>
      )}</>}

      {modalAberto && (
        <div className="modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editId ? "Editar" : "Novo"} Reserva</h3>
            {erroSalvar && <div className="campo-erro modal-erro">{erroSalvar}</div>}
            <form onSubmit={salvar}>
              <label className="field-label">acomodacaoId</label>
      <input type="number" value={form["acomodacaoId"] ?? ""} onChange={e => setForm({...form, acomodacaoId: e.target.value})} />
      <label className="field-label">hospedeId</label>
      <input type="number" value={form["hospedeId"] ?? ""} onChange={e => setForm({...form, hospedeId: e.target.value})} />
      <label className="field-label">checkIn</label>
      <input type="datetime-local" value={form["checkIn"] ?? ""} onChange={e => setForm({...form, checkIn: e.target.value})} />
      <label className="field-label">checkOut</label>
      <input type="datetime-local" value={form["checkOut"] ?? ""} onChange={e => setForm({...form, checkOut: e.target.value})} />
      <label className="field-label">totalNoites</label>
      <input type="number" value={form["totalNoites"] ?? ""} onChange={e => setForm({...form, totalNoites: e.target.value})} />
      <label className="field-label">valorTotal</label>
      <input type="number" step="0.01" value={form["valorTotal"] ?? ""} onChange={e => setForm({...form, valorTotal: e.target.value})} />
      <label className="field-label checkbox-label">
        <input type="checkbox" checked={form["cafeDaManha"] === true || form["cafeDaManha"] === "true"} onChange={e => setForm({...form, cafeDaManha: e.target.checked})} />
        cafeDaManha
      </label>
      <label className="field-label">status</label>
      <select value={form["status"] ?? "AGENDADA"} onChange={e => setForm({...form, status: e.target.value})}>
        <option value="AGENDADA">AGENDADA</option>
        <option value="REALIZADA">REALIZADA</option>
        <option value="CANCELADA">CANCELADA</option>
      </select>
      <label className="field-label">acomodacao</label>
      <select value={form["acomodacao"] ?? ""} onChange={e => setForm({...form, acomodacao: e.target.value})}>
        <option value="">Selecione...</option>
        {(acomodacaoList || []).map(o => (<option key={o.id} value={o.id}>{o.nome ?? ("#" + o.id)}</option>))}
      </select>
      <label className="field-label">hospede</label>
      <select value={form["hospede"] ?? ""} onChange={e => setForm({...form, hospede: e.target.value})}>
        <option value="">Selecione...</option>
        {(hospedeList || []).map(o => (<option key={o.id} value={o.id}>{o.nome ?? ("#" + o.id)}</option>))}
      </select>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PainelConsumo({ token, apiBaseUrl, onPix, role, onLogout }) {
  const [itens, setItens] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [form, setForm] = React.useState({});
  const [editId, setEditId] = React.useState(null);
  const [modalAberto, setModalAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(1);
  const [reservaList, setReservaList] = React.useState([]);

  // Paginação real (achado real auditando como cliente exigente: lista sem
  // limite nenhum, "queria ver pelo menos os 10 primeiros"). Front-end só —
  // não muda o contrato da API (que os outros 9 projetos já usam tal como
  // está), só corta o que já foi carregado em páginas de 10.
  const itensFiltrados = itens.filter(item => !busca || ["reservaId", "descricao", "tipo", "quantidade", "valorUnit", "valorTotal", "data", "id"].some(k => String(item[k] ?? "").toLowerCase().includes(busca.toLowerCase())));
  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / 10));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const itensPagina = itensFiltrados.slice((paginaAtual - 1) * 10, paginaAtual * 10);

  const carregar = () => fetch(apiBaseUrl + "/api/consumos", { headers: authHeaders(token) })
    .then(r => { if (r.status === 401) { onLogout && onLogout(); return []; } return r.json(); })
    .then(data => { if (Array.isArray(data)) setItens(data); })
    .catch(() => setItens([]))
    .finally(() => setCarregando(false));

  React.useEffect(() => {
    carregar();
    fetch(apiBaseUrl + "/api/reservas", { headers: authHeaders(token) }).then(r => r.json()).then(setReservaList).catch(() => {});
  }, [token]);

  // Bug GRAVE achado real (2026-06-24, testando o formulário de verdade
  // pelo navegador, não só por API): mandava {cliente: {id: 5}} pro
  // backend, mas o RequestDTO espera "clienteId": 5 (chave plana) — TODO
  // formulário com relacionamento (dropdown) falhava 400 silenciosamente
  // (sem .catch, o modal fechava como se tivesse dado certo). Afetava
  // TODOS os 10 projetos, qualquer entidade com relacionamento.
  const montarCorpo = () => {
    const corpo = { ...form };
    ["reserva"].forEach(k => {
      corpo[k + "Id"] = corpo[k] ? Number(corpo[k]) : null;
      delete corpo[k];
    });
    // Bug real (2026-06-26): <input type="datetime-local"> envia "YYYY-MM-DDTHH:mm"
    // sem segundos, mas LocalDateTime precisa de "YYYY-MM-DDTHH:mm:ss" — Jackson
    // rejeita o formato curto com 400. Normaliza para ISO completo antes de enviar.
    Object.keys(corpo).forEach(k => {
      if (typeof corpo[k] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(corpo[k]))
        corpo[k] = corpo[k] + ':00';
    });
    return corpo;
  };

  const [erroSalvar, setErroSalvar] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const salvar = (e) => {
    e.preventDefault();
    if (salvando) return;
    setErroSalvar("");
    setSalvando(true);
    const url = editId ? apiBaseUrl + "/api/consumos/" + editId : apiBaseUrl + "/api/consumos";
    fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(montarCorpo()),
    }).then(async r => {
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        const msg = corpo.erros ? Object.entries(corpo.erros).map(([k, v]) => k + ": " + v).join("; ") : (corpo.erro || "Erro ao salvar.");
        throw new Error(msg);
      }
      return carregar();
    }).then(() => { setSalvando(false); setForm({}); setEditId(null); setModalAberto(false); })
      .catch(err => { setSalvando(false); setErroSalvar(err.message); });
  };

  const editar = (item) => {
    const f = {};
    ["reservaId", "descricao", "tipo", "quantidade", "valorUnit", "valorTotal", "data"].forEach(k => { f[k] = item[k] ?? ""; });
    ["reserva"].forEach(k => { f[k] = item[k + "Id"] ?? ""; });
    setErroSalvar(""); setForm(f); setEditId(item.id); setModalAberto(true);
  };

  const apagar = (id) => fetch(apiBaseUrl + "/api/consumos/" + id, { method: "DELETE", headers: authHeaders(token) })
    .then(async r => {
      if (r.status === 401) { onLogout && onLogout(); return; }
      if (!r.ok) {
        const corpo = await r.json().catch(() => ({}));
        alert("Erro ao excluir: " + (corpo.erro || corpo.mensagem || "Verifique se não há registros vinculados."));
        return;
      }
      carregar();
    })
    .catch(err => alert("Erro ao excluir: " + err.message));

  const gerarPix = (valor) => onPix(valor);

  return (
    <div>
      <div className="panel-header">
        <h2>Consumo</h2>
        <div className="panel-header-right">
          <div className="search-wrap">
            <span className="search-ico">🔎</span>
            <input className="search-input" placeholder="Buscar..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }} />
          </div>
          
          <button className="btn btn-primary" onClick={() => { setForm({}); setEditId(null); setErroSalvar(""); setModalAberto(true); }}>+ Novo</button>
        </div>
      </div>

      {carregando && <div className="empty-state">Carregando...</div>}
      {!carregando && itens.length === 0 && <div className="empty-state">Nenhum registro ainda. Clique em "+ Novo" pra criar o primeiro.</div>}
      {!carregando && itens.length > 0 && itensFiltrados.length === 0 && <div className="empty-state">Nenhum resultado para a busca "{"}}busca{{"}".</div>}

      {true && <><div className="items-grid">
        {itensPagina.map(item => (
          <div className="item-card" key={item.id}>
            <div className="item-photo-wrap">
              <div className="item-photo-fallback">C</div>
              <img className="item-photo" style={{display: "none"}} src={"https://picsum.photos/seed/consumo" + item.id + "/320/200"} alt="Consumo" loading="lazy" onLoad={e => { e.target.style.display = "block"; e.target.previousSibling.style.display = "none"; }} />
            </div>
            <div className="item-card-header">
              <div className="item-icon-badge">🗂️</div>
              <span className="item-id-tag">#{item.id}</span>
            </div>
            <div className="item-title">{String(item["descricao"] ?? "Consumo")}</div>
            
            <div className="item-meta-grid">
            <div className="item-field"><b>reservaId</b><span>{item["reservaId"] ?? "—"}</span></div>
            <div className="item-field"><b>tipo</b><span>{item["tipo"] ?? "—"}</span></div>
            <div className="item-field"><b>quantidade</b><span>{item["quantidade"] ?? "—"}</span></div>
            <div className="item-field"><b>valorUnit</b><span>{item["valorUnit"] != null ? Number(item["valorUnit"]).toLocaleString("pt-BR", {style:"currency",currency:"BRL"}) : "—"}</span></div>
            <div className="item-field"><b>valorTotal</b><span>{item["valorTotal"] != null ? Number(item["valorTotal"]).toLocaleString("pt-BR", {style:"currency",currency:"BRL"}) : "—"}</span></div>
            <div className="item-field"><b>data</b><span>{item["data"] ? new Date(item["data"]).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"}) : "—"}</span></div>
            <div className="item-field"><b>reserva</b><span>{item.reservaId ? ((reservaList.find(o => o.id === item.reservaId) || {}).status ?? ("#" + item.reservaId)) : "—"}</span></div>
            </div>
            <div className="item-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => editar(item)}>Editar</button>
              {role === "ADMIN" && <button className="btn btn-danger btn-sm" onClick={() => { if(window.confirm("Confirmar exclusão?")) apagar(item.id); }}>Apagar</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => gerarPix(item.valorUnit)}>Cobrar via Pix</button>
              
            </div>
          </div>
        ))}
      </div>

      {totalPaginas > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
          <span className="pagination-info">Página {paginaAtual} de {totalPaginas} ({itensFiltrados.length} no total)</span>
          <button className="btn btn-ghost btn-sm" disabled={paginaAtual === totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima →</button>
        </div>
      )}</>}

      {modalAberto && (
        <div className="modal-overlay" onClick={() => setModalAberto(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editId ? "Editar" : "Novo"} Consumo</h3>
            {erroSalvar && <div className="campo-erro modal-erro">{erroSalvar}</div>}
            <form onSubmit={salvar}>
              <label className="field-label">reservaId</label>
      <input type="number" value={form["reservaId"] ?? ""} onChange={e => setForm({...form, reservaId: e.target.value})} />
      <label className="field-label">descricao</label>
      <textarea rows={3} value={form["descricao"] ?? ""} onChange={e => setForm({...form, descricao: e.target.value})} />
      <label className="field-label">tipo</label>
      <input type="text" value={form["tipo"] ?? ""} onChange={e => setForm({...form, tipo: e.target.value})} />
      <label className="field-label">quantidade</label>
      <input type="number" value={form["quantidade"] ?? ""} onChange={e => setForm({...form, quantidade: e.target.value})} />
      <label className="field-label">valorUnit</label>
      <input type="number" step="0.01" value={form["valorUnit"] ?? ""} onChange={e => setForm({...form, valorUnit: e.target.value})} />
      <label className="field-label">valorTotal</label>
      <input type="number" step="0.01" value={form["valorTotal"] ?? ""} onChange={e => setForm({...form, valorTotal: e.target.value})} />
      <label className="field-label">data</label>
      <input type="datetime-local" value={form["data"] ?? ""} onChange={e => setForm({...form, data: e.target.value})} />
      <label className="field-label">reserva</label>
      <select value={form["reserva"] ?? ""} onChange={e => setForm({...form, reserva: e.target.value})}>
        <option value="">Selecione...</option>
        {(reservaList || []).map(o => (<option key={o.id} value={o.id}>{o.status ?? ("#" + o.id)}</option>))}
      </select>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


export default function App() {
  const [token, setToken] = React.useState(localStorage.getItem("token") || "");
  const [role, setRole] = React.useState(localStorage.getItem("role") || "USER");
  const [currentUser, setCurrentUser] = React.useState(localStorage.getItem("currentUser") || "");
  const [aba, setAba] = React.useState("Acomodacao");
  const [pixValor, setPixValor] = React.useState(null);

  const fazerLogin = (t, r, u) => {
    localStorage.setItem("token", t);
    localStorage.setItem("role", r || "USER");
    if (u) localStorage.setItem("currentUser", u);
    setToken(t); setRole(r || "USER"); setCurrentUser(u || "");
  };
  const sair = () => {
    localStorage.removeItem("token"); localStorage.removeItem("role"); localStorage.removeItem("currentUser");
    setToken(""); setRole("USER"); setCurrentUser("");
  };
  const abrirPix = (valor) => setPixValor(valor);

  if (!token) {
    return <LoginScreen onLogin={fazerLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">Pousada<span className="dot">.</span></div>
        <button className={"nav-btn" + (aba === "Acomodacao" ? " active" : "")} onClick={() => setAba("Acomodacao")}><span className="nav-ico">🗂️</span>Acomodacao</button>
        <button className={"nav-btn" + (aba === "Hospede" ? " active" : "")} onClick={() => setAba("Hospede")}><span className="nav-ico">🗂️</span>Hospede</button>
        <button className={"nav-btn" + (aba === "Reserva" ? " active" : "")} onClick={() => setAba("Reserva")}><span className="nav-ico">🗂️</span>Reserva</button>
        <button className={"nav-btn" + (aba === "Consumo" ? " active" : "")} onClick={() => setAba("Consumo")}><span className="nav-ico">🗂️</span>Consumo</button>
        <div className="sidebar-bottom">
          <button className="logout-btn" onClick={sair}>Sair</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{aba}</h1>
          <span className="topbar-user">{currentUser && <span className="topbar-greeting">Olá, {currentUser}</span>}<span className="role-badge">{role}</span></span>
        </div>
        
        <DashboardResumo token={token} />
        {aba === "Acomodacao" && <PainelAcomodacao token={token} apiBaseUrl={apiBaseUrl} onPix={abrirPix} role={role} onLogout={sair} />}
      {aba === "Hospede" && <PainelHospede token={token} apiBaseUrl={apiBaseUrl} onPix={abrirPix} role={role} onLogout={sair} />}
      {aba === "Reserva" && <PainelReserva token={token} apiBaseUrl={apiBaseUrl} onPix={abrirPix} role={role} onLogout={sair} />}
      {aba === "Consumo" && <PainelConsumo token={token} apiBaseUrl={apiBaseUrl} onPix={abrirPix} role={role} onLogout={sair} />}
      </main>
      {pixValor !== null && <PixModal valor={pixValor} token={token} onClose={() => setPixValor(null)} />}
    </div>
  );
}
