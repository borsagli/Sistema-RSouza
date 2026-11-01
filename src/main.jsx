import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const pages = [
  ['dashboard', 'Visão geral', '◈'], ['clients', 'Clientes e perfis', '♙'],
  ['employees', 'Funcionários', '▦'], ['campaigns', 'Campanhas', '↗'],
  ['channels', 'Canais', '▤'], ['pieces', 'Peças de divulgação', '▧'],
  ['publications', 'Publicações', '▤'], ['receives', 'Recebimentos', '☏'],
  ['interactions', 'Interações WhatsApp', '♡'], ['database', 'Banco de dados', '▥'],
];
const titles = {
  clients: 'cliente', employees: 'funcionário', campaigns: 'campanha', channels: 'canal',
  pieces: 'peça', publications: 'publicação', interactions: 'interação', receives: 'visualização manual',
};
const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const localTime = value => {
  const time = new Date(value);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
};
const badge = value => <span className={`badge ${['Ativo', 'Simulada', 'Enviado', 'Interessado'].includes(value) ? 'interested' : ['Cancelada', 'Inativo'].includes(value) ? 'not_interested' : 'scheduled'}`}>{value === 'Enviado' ? 'Enviado (simulado)' : value}</span>;
const keyOf = (type, row) => ({
  clients: row.CNPJ, employees: row.ID_FUNCIONARIO, campaigns: row.ID_CAMPANHA,
  channels: row.ID_CANAL, pieces: `${row.ID_CAMPANHA}/${row.numero_peca}`,
  publications: row.ID_PUBLICACAO, interactions: row.ID_INTERACAO, receives: `${row.ID_CAMPANHA}/${row.CNPJ_CLIENTE}`,
}[type]);
const nowFields = () => {
  const now = new Date().toISOString();
  return { data_publicacao: now.slice(0, 10), horario: now.slice(11, 19) };
};
const initial = type => ({
  clients: { CNPJ: '', razao_social: '', nome_fantasia: '', email: '', rua: '', numero: '', bairro: '', cidade: '', pais: 'Brasil', cep: '', total_gasto: '0', telefones: [], interesses_texto: '', preferencias_texto: '' },
  employees: { nome: '', especializacao: 'RESPONSAVEL_DIVULGACAO', ID_SUPERVISOR: '' },
  campaigns: { titulo_oferta: '', texto_mensagem: '', ID_RESPONSAVEL: '', envio_mensagens: 'Rascunho', status: 'Ativo', data_agendamento: '', clientes: [], canais: [] },
  channels: { nome: '', tipo: '' },
  pieces: { ID_CAMPANHA: '', numero_peca: 1, tipo: '', nome_arquivo: '', formato: 'PNG' },
  publications: { ID_CAMPANHA: '', ID_CANAL: '', ...nowFields(), conteudo: '' },
  interactions: { ID_CAMPANHA: '', CNPJ_CLIENTE: '', ID_ATENDENTE: '', data_hora: localTime(new Date()), tipo_interacao: 'Resposta demonstrativa', status: 'Em atendimento' },
  receives: { data_visualizacao: '' },
}[type]);
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Falha na solicitação.'), { status: response.status });
  return data;
}
function Input({ label, value, onChange, type = 'text', ...props }) {
  return <label>{label}<input type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} {...props} /></label>;
}

function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [data, setData] = useState({ clients: [], employees: [], campaigns: [], channels: [], pieces: [], publications: [], receives: [], interactions: [], database: [], dashboard: null });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ interesse: '', preferencia: '', gasto_min: '', gasto_max: '' });
  const [filteredClients, setFilteredClients] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [audienceFilter, setAudienceFilter] = useState({ interesse: '', preferencia: '', gasto_min: '', gasto_max: '' });
  const [login, setLogin] = useState({ username: '', password: '' });
  const [confirmation, setConfirmation] = useState(null);
  const report = error => {
    setNotice({ error: true, text: error.message });
    if (error.status === 401) { setUser(null); setModal(null); setConfirmation(null); }
  };
  async function reload() {
    setLoading(true);
    try {
      const keys = ['clients', 'employees', 'campaigns', 'channels', 'pieces', 'publications', 'receives', 'interactions', 'database', 'dashboard'];
      const results = await Promise.all(keys.map(path => api(path)));
      setData(Object.fromEntries(keys.map((key, i) => [key, results[i]])));
      if (page === 'clients' && appliedFilters !== null) setFilteredClients(await api(`clients?${new URLSearchParams(appliedFilters)}`));
    } finally { setLoading(false); }
  }
  useEffect(() => {
    api('me').then(setUser).catch(error => { if (error.status !== 401) report(error); }).finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    reload().catch(report);
    const timer = setInterval(() => reload().catch(report), 15_000);
    return () => clearInterval(timer);
  }, [user, page, appliedFilters]);
  async function act(work, message) {
    setBusy(true);
    setNotice(null);
    try { await work(); await reload(); setNotice({ text: message }); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function authenticate(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try { await api('login', 'POST', login); setUser(await api('me')); setLogin({ username: '', password: '' }); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  function open(type, row, defaults = {}) {
    const values = { ...initial(type), ...row, ...defaults };
    if (type === 'clients' && row) {
      values.telefones = row.telefones.map(phone => ({ ...phone }));
      values.interesses_texto = row.interesses.join(', ');
      values.preferencias_texto = row.preferencias.join(', ');
    }
    if (type === 'campaigns' && row?.data_agendamento) values.data_agendamento = localTime(row.data_agendamento);
    if (type === 'interactions' && row) values.data_hora = localTime(row.data_hora);
    if (type === 'receives') values.data_visualizacao = row.data_visualizacao ? localTime(row.data_visualizacao) : '';
    setModal({ type, id: row ? keyOf(type, row) : null, values });
    setAudienceFilter({ interesse: '', preferencia: '', gasto_min: '', gasto_max: '' });
    setNotice(null);
  }
  const field = (key, value) => setModal(current => ({ ...current, values: { ...current.values, [key]: value } }));
  const toggle = (key, value, checked) => field(key, checked ? [...modal.values[key], value] : modal.values[key].filter(item => item !== value));
  async function save(event) {
    event.preventDefault();
    const { type, id, values } = modal;
    await act(async () => {
      const body = { ...values };
      if (type === 'clients') {
        const tags = value => value.split(',').map(item => item.trim()).filter(Boolean);
        body.interesses = tags(values.interesses_texto);
        body.preferencias = tags(values.preferencias_texto);
      }
      if (type === 'campaigns' && body.envio_mensagens === 'Agendada') body.data_agendamento = new Date(body.data_agendamento).toISOString();
      if (type === 'interactions') body.data_hora = new Date(body.data_hora).toISOString();
      if (type === 'receives') body.data_visualizacao = body.data_visualizacao ? new Date(body.data_visualizacao).toISOString() : null;
      await api(`${type}${id !== null ? `/${id}` : ''}`, id !== null ? 'PUT' : 'POST', body);
      setModal(null);
    }, 'Registro salvo com sucesso.');
  }
  const confirm = (title, detail, work, message) => setConfirmation({ title, detail, work, message });
  const remove = (type, row) => confirm('Excluir registro?', 'Os vínculos obrigatórios e o histórico podem impedir a exclusão.',
    () => api(`${type}/${keyOf(type, row)}`, 'DELETE'), 'Registro excluído.');
  const changePage = next => {
    setPage(next); setSearch(''); setNotice(null); setFilteredClients(null); setAppliedFilters(null);
    setFilters({ interesse: '', preferencia: '', gasto_min: '', gasto_max: '' });
  };
  const controls = (type, row) => <div className="actions wrap">
    <button className="secondary small" onClick={() => open(type, row)} disabled={busy}>Editar</button>
    <button className="text-button danger" onClick={() => remove(type, row)} disabled={busy}>Excluir</button>
  </div>;
  const rows = (page === 'dashboard' ? [] : page === 'clients' && filteredClients !== null ? filteredClients : data[page] || [])
    .filter(row => JSON.stringify(row).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const responsible = data.employees.filter(employee => employee.especializacao === 'RESPONSAVEL_DIVULGACAO');
  const attendants = data.employees.filter(employee => employee.especializacao === 'ATENDENTE_WHATSAPP');
  const pendingCampaigns = data.campaigns.filter(campaign => campaign.envio_mensagens !== 'Simulada');
  const sent = data.receives.filter(row => row.status_envio === 'Enviado');
  const interests = [...new Set(data.clients.flatMap(client => client.interesses))].sort();
  const preferences = [...new Set(data.clients.flatMap(client => client.preferencias))].sort();
  const filterFields = (values, update) => <div className="filter-fields">
    <label>Interesse<select value={values.interesse} onChange={event => update({ ...values, interesse: event.target.value })}><option value="">Qualquer interesse</option>{interests.map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Preferência<select value={values.preferencia} onChange={event => update({ ...values, preferencia: event.target.value })}><option value="">Qualquer preferência</option>{preferences.map(value => <option key={value}>{value}</option>)}</select></label>
    <Input label="Gasto mínimo (R$)" type="number" min="0" step="0.01" value={values.gasto_min} onChange={value => update({ ...values, gasto_min: value })} />
    <Input label="Gasto máximo (R$)" type="number" min="0" step="0.01" value={values.gasto_max} onChange={value => update({ ...values, gasto_max: value })} />
  </div>;
  if (booting) return <main className="boot">Carregando central de campanhas...</main>;
  if (!user) return <main className="login-layout">
    <section className="login-story">
      <div className="brand"><span className="brand-mark">R</span><span>RSOUZA<small>AUTO PEÇAS</small></span></div>
      <span className="eyebrow">RELACIONAMENTO QUE MOVE NEGÓCIOS</span>
      <h1>A peça certa.<br />A mensagem certa.<br /><em>O cliente certo.</em></h1>
      <p>Cadastre empresas pelo CNPJ, conheça seus interesses e organize campanhas para suas garagens de ônibus.</p>
      <div className="story-tags"><span>Perfil do cliente</span><span>Campanhas</span><span>Atendimento</span></div>
      <small>Projeto acadêmico • Modelo Descritivo R Souza</small>
    </section>
    <section className="login-panel"><form onSubmit={authenticate} className="login-card">
      <span className="eyebrow">CENTRAL DE CAMPANHAS</span><h2>Bem-vindo de volta</h2><p>Entre para gerenciar o relacionamento com seus clientes.</p>
      {notice && <div role="alert" className="notice error">{notice.text}</div>}
      <Input label="Usuário" autoComplete="username" required value={login.username} onChange={value => setLogin({ ...login, username: value })} />
      <Input label="Senha" type="password" autoComplete="current-password" required maxLength={200} value={login.password} onChange={value => setLogin({ ...login, password: value })} />
      <button className="primary" disabled={busy}>{busy ? 'Entrando...' : 'Entrar no sistema →'}</button>
      <div className="demo-note"><strong>Ambiente demonstrativo</strong><br />Não envia mensagens automaticamente. Empresas, CNPJs, gastos e contatos iniciais são fictícios.</div>
    </form></section>
  </main>;
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">R</span><span>RSOUZA<small>AUTO PEÇAS</small></span></div>
      <small className="nav-caption">MODELO DESCRITIVO • MER</small>
      <nav aria-label="Menu principal">{pages.map(([key, title, icon]) => <button key={key} className={page === key ? 'nav-active' : ''} onClick={() => changePage(key)}><span aria-hidden="true">{icon}</span>{title}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> Modo demonstrativo<p>Modelo relacional.<br />Envios simulados.</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>{user.company}</span><div><span className="avatar">A</span><span>{user.username}</span><button className="text-button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api('logout', 'POST'); setUser(null); setNotice(null); setModal(null); setConfirmation(null); }
        catch (error) { report(error); } finally { setBusy(false); }
      }}>Sair</button></div></header>
      <main className="content">
        <div className="demo-banner"><strong>DEMONSTRAÇÃO</strong><span>“Enviado” em RECEBE significa simulado. Nenhuma mensagem, visualização ou resposta é confirmada pela API do WhatsApp.</span></div>
        <div className="page-heading"><div><span className="eyebrow">RELACIONAMENTO & CAMPANHAS</span><h1>{pages.find(([key]) => key === page)[1]}</h1><p>{{
          dashboard: 'Empresas, campanhas e interações organizadas pelo modelo relacional.',
          clients: 'CNPJ, endereço, telefones multivalorados e perfil individual obrigatório.',
          employees: 'Especialização total e disjunta: responsável ou atendente.',
          campaigns: 'Responsável, mensagem, destinatários, canais e agendamento.',
          channels: 'Canais vinculados às campanhas pelo relacionamento UTILIZA.',
          pieces: 'Peças dependentes da campanha: chave composta campanha + número.',
          publications: 'Conteúdo, data e horário UTC de cada publicação demonstrativa.',
          receives: 'Relacionamento N:N entre cliente e campanha; visualização apenas manual.',
          interactions: 'Respostas demonstrativas vinculadas ao cliente, campanha e atendente.',
          database: 'Consulta somente leitura das quinze tabelas persistidas no SQLite.',
        }[page]}</p></div>
          {titles[page] && page !== 'receives' ? <button className="primary" disabled={busy} onClick={() => open(page)}>+ Cadastrar {titles[page]}</button> : <button className="secondary" disabled={loading} onClick={() => reload().catch(report)}>{loading ? 'Atualizando...' : '↻ Atualizar'}</button>}
        </div>
        {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice ${notice.error ? 'error' : 'success'}`}>{notice.text}</div>}
        {page === 'dashboard' && data.dashboard && <>
          <div className="stats">{[
            ['Empresas cadastradas', data.dashboard.clientes, 'Cada CNPJ possui um perfil', '♙'],
            ['Campanhas', data.dashboard.campanhas, `${data.dashboard.agendadas} agendada(s) ativa(s)`, '↗'],
            ['Recebimentos simulados', data.dashboard.simulacoes, 'RECEBE • sem envio real', '▤'],
            ['Interações', data.dashboard.interacoes, 'Atendente obrigatório', '♡'],
          ].map(([title, value, subtitle, icon]) => <article className="stat" key={title}><span className="stat-icon">{icon}</span><p>{title}</p><strong>{value}</strong><small>{subtitle}</small></article>)}</div>
          <div className="dashboard-grid"><section className="card"><div className="card-heading"><h2>Campanhas recentes</h2><button className="text-button" onClick={() => changePage('campaigns')}>Ver todas →</button></div><div className="table-scroll"><table><thead><tr><th>Campanha</th><th>Responsável</th><th>Execução</th></tr></thead><tbody>{data.dashboard.recentes.map(row => <tr key={row.ID_CAMPANHA}><td><strong>{row.titulo_oferta}</strong><small>{date(row.data_agendamento)}</small></td><td>{row.responsavel_nome}</td><td>{badge(row.envio_mensagens)}</td></tr>)}</tbody></table></div></section>
            <section className="flow-card"><span className="eyebrow">FLUXO DO MODELO DESCRITIVO</span><h2>Do perfil<br />à interação.</h2><ol><li>Cadastre empresa e perfil</li><li>Filtre interesse, preferência e gasto</li><li>Defina responsável e canais</li><li>Simule e registre atendimento</li></ol><button className="primary" onClick={() => { changePage('campaigns'); open('campaigns'); }}>Criar uma campanha →</button></section></div>
          <div className="privacy-card"><strong>Dados exclusivamente fictícios</strong><p>Total gasto é um valor demonstrativo informado, não calculado de vendas. O modelo não contém histórico comercial. Não envie mensagens aos telefones de exemplo.</p></div>
        </>}
        {page === 'database' && data.database.map(table => <section className="card database-table" key={table.name}>
          <div className="card-heading"><h2>{table.name}</h2><span className="badge">{table.count} registro(s)</span></div>
          <p className="help-text database-meta">{table.columns.map(column => `${column.name}${column.pk ? ` (PK ${column.pk})` : ''}`).join(' • ')}{table.foreignKeys.length > 0 && <><br />Relacionamentos: {table.foreignKeys.map(key => `${key.from} → ${key.table}.${key.to}`).join(' • ')}</>}</p>
          <div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map(column => <td className="database-cell" key={column.name}>{String(row[column.name] ?? 'NULL')}</td>)}</tr>)}</tbody></table></div>{!table.rows.length && <p className="empty">Tabela vazia.</p>}
        </section>)}
        {!['dashboard', 'database'].includes(page) && <>
          {page === 'clients' && <section className="card filter-card"><h2>Segmentação por perfil e gasto</h2>{filterFields(filters, setFilters)}<div className="actions"><button className="primary small" disabled={busy} onClick={() => act(async () => { setFilteredClients(await api(`clients?${new URLSearchParams(filters)}`)); setAppliedFilters({ ...filters }); }, 'Filtros aplicados.')}>Aplicar filtros</button><button className="secondary small" onClick={() => { setFilteredClients(null); setAppliedFilters(null); setFilters({ interesse: '', preferencia: '', gasto_min: '', gasto_max: '' }); }}>Limpar filtros</button></div><p className="help-text">Os filtros são combinados com E: o cliente precisa atender a todos os critérios preenchidos.</p></section>}
          <div className="toolbar"><input aria-label="Buscar registros" placeholder="Buscar nos registros..." value={search} onChange={event => setSearch(event.target.value)} /><span>{rows.length} registro(s)</span></div>
          <section className="card table-scroll"><table><thead><tr>{{
            clients: ['Empresa / CNPJ', 'Contato e endereço', 'Perfil', 'Total gasto (demo)', 'Ações'],
            employees: ['Funcionário', 'Especialização', 'Supervisor', 'Ações'],
            campaigns: ['Campanha / responsável', 'Agendamento', 'Status / execução', 'Clientes / canais', 'Ações'],
            channels: ['ID / nome', 'Tipo', 'Ações'],
            pieces: ['Chave composta', 'Campanha', 'Arquivo / formato', 'Tipo', 'Ações'],
            publications: ['Publicação / campanha', 'Canal', 'Data / horário UTC', 'Conteúdo', 'Ações'],
            receives: ['Cliente / campanha', 'Status de envio', 'Data de envio simulado', 'Visualização manual', 'Ações'],
            interactions: ['Interação / cliente', 'Campanha', 'Atendente / data', 'Tipo / status', 'Ações'],
          }[page].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={keyOf(page, row)}>
            {page === 'clients' && <><td><strong>{row.razao_social}</strong><small>{row.CNPJ}</small><small>{row.nome_fantasia}</small></td><td>{row.email}{row.telefones.map(phone => <small key={phone.numero}>{phone.numero} • {phone.tipo || 'Tipo não informado'}</small>)}<small>{[row.rua, row.numero, row.bairro, row.cidade, row.cep, row.pais].filter(Boolean).join(', ')}</small></td><td><strong>Interesses</strong>{row.interesses.join(', ') || '—'}<small>Preferências: {row.preferencias.join(', ') || '—'}</small></td><td>{money(row.total_gasto)}</td><td>{controls(page, row)}</td></>}
            {page === 'employees' && <><td><strong>{row.nome}</strong><small>#{row.ID_FUNCIONARIO}</small></td><td>{row.especializacao === 'RESPONSAVEL_DIVULGACAO' ? 'Responsável divulgação' : 'Atendente WhatsApp'}</td><td>{row.supervisor_nome || '—'}</td><td>{controls(page, row)}</td></>}
            {page === 'campaigns' && <><td><strong>{row.titulo_oferta}</strong><small>#{row.ID_CAMPANHA} • {row.responsavel_nome}</small></td><td>{date(row.data_agendamento)}</td><td>{badge(row.status)}<small>{badge(row.envio_mensagens)}</small></td><td>{row.destinatarios} cliente(s)<small>{row.canais.length} canal(is) • {row.simulados} simulado(s)</small></td><td><div className="actions wrap">
              {row.envio_mensagens !== 'Simulada' && <button className="secondary small" disabled={busy} onClick={() => open(page, row)}>Editar</button>}
              {row.status === 'Ativo' && ['Rascunho', 'Agendada'].includes(row.envio_mensagens) && <button className="primary small" disabled={busy} onClick={() => confirm('Simular campanha agora?', 'RECEBE será marcado como Enviado apenas em simulação. Serão criadas publicações para os canais selecionados; nenhuma mensagem real será enviada.', () => api(`campaigns/${row.ID_CAMPANHA}/simulate`, 'POST'), 'Simulação concluída. Consulte Recebimentos e Publicações.')}>Simular</button>}
              {['Rascunho', 'Agendada'].includes(row.envio_mensagens) && <button className="text-button danger" disabled={busy} onClick={() => confirm('Cancelar campanha?', 'A campanha ficará Inativa e não será processada pelo agendador.', () => api(`campaigns/${row.ID_CAMPANHA}/cancel`, 'POST'), 'Campanha cancelada.')}>Cancelar</button>}
              {['Rascunho', 'Cancelada'].includes(row.envio_mensagens) && <button className="text-button danger" disabled={busy} onClick={() => remove(page, row)}>Excluir</button>}
              <button className="text-button" onClick={() => { changePage('receives'); setSearch(row.titulo_oferta); }}>Destinatários →</button>
            </div></td></>}
            {page === 'channels' && <><td><strong>{row.nome}</strong><small>#{row.ID_CANAL}</small></td><td>{row.tipo || '—'}</td><td>{controls(page, row)}</td></>}
            {page === 'pieces' && <><td><strong>({row.ID_CAMPANHA}, {row.numero_peca})</strong></td><td>{row.titulo_oferta}</td><td>{row.nome_arquivo}<small>{row.formato}</small></td><td>{row.tipo || '—'}</td><td>{pendingCampaigns.some(c => c.ID_CAMPANHA === row.ID_CAMPANHA) ? controls(page, row) : 'Histórico preservado'}</td></>}
            {page === 'publications' && <><td><strong>#{row.ID_PUBLICACAO}</strong><small>{row.titulo_oferta}</small></td><td>{row.canal_nome}</td><td>{row.data_publicacao}<small>{row.horario} UTC</small></td><td className="content-cell">{row.conteudo || '—'}</td><td>{controls(page, row)}</td></>}
            {page === 'receives' && <><td><strong>{row.cliente_nome}</strong><small>{row.CNPJ_CLIENTE}</small><small>{row.titulo_oferta}</small></td><td>{badge(row.status_envio)}</td><td>{date(row.data_envio)}</td><td>{date(row.data_visualizacao)}</td><td>{row.status_envio === 'Enviado' && <div className="actions wrap"><button className="secondary small" onClick={() => open('interactions', null, { ID_CAMPANHA: row.ID_CAMPANHA, CNPJ_CLIENTE: row.CNPJ_CLIENTE })}>Registrar interação</button><button className="text-button" onClick={() => open('receives', row)}>Visualização manual</button>{row.telefones.map(phone => <a key={phone.numero} className="whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${phone.numero}?text=${encodeURIComponent(row.mensagem)}`}>WhatsApp: {phone.numero} ↗</a>)}</div>}</td></>}
            {page === 'interactions' && <><td><strong>#{row.ID_INTERACAO} • {row.cliente_nome}</strong><small>{row.CNPJ_CLIENTE}</small></td><td>{row.titulo_oferta}</td><td>{row.atendente_nome}<small>{date(row.data_hora)}</small></td><td>{row.tipo_interacao || '—'}<small>{badge(row.status)}</small></td><td>{controls(page, row)}</td></>}
          </tr>)}</tbody></table></section>
          {!rows.length && <div className="empty card"><h2>Nenhum registro encontrado</h2><p>Cadastre um registro, simule uma campanha ou ajuste os filtros.</p></div>}
          {['receives', 'interactions', 'publications', 'pieces'].includes(page) && <p className="help-text">Dados demonstrativos. WhatsApp apenas abre texto preenchido para confirmação manual. Não há envio, upload de peças, leitura ou resposta automática. Não contate os números fictícios; para contatos reais, obtenha autorização antes de enviar.</p>}
        </>}
        <footer>RSouza • Modelo Descritivo e dicionário conciliados • Projeto acadêmico</footer>
      </main>
    </div>
    {modal && <div className="modal-backdrop"><section className={`modal ${['clients', 'campaigns'].includes(modal.type) ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="card-heading"><h2 id="modal-title">{modal.id !== null ? 'Editar' : 'Cadastrar'} {titles[modal.type]}</h2><button className="text-button" aria-label="Fechar formulário" disabled={busy} onClick={() => setModal(null)}>✕</button></div>
      {notice?.error && <div role="alert" className="notice error">{notice.text}</div>}
      <form onSubmit={save}>
        {modal.type === 'clients' && <>
          <div className="form-grid">
            <Input label="CNPJ" required maxLength={18} disabled={modal.id !== null} value={modal.values.CNPJ} onChange={value => field('CNPJ', value)} />
            <Input label="Razão social" required maxLength={150} value={modal.values.razao_social} onChange={value => field('razao_social', value)} />
            <Input label="Nome fantasia" maxLength={100} value={modal.values.nome_fantasia} onChange={value => field('nome_fantasia', value)} />
            <Input label="E-mail" type="email" required maxLength={100} value={modal.values.email} onChange={value => field('email', value)} />
            {[['rua', 'Rua', 100], ['numero', 'Número', 10], ['bairro', 'Bairro', 50], ['cidade', 'Cidade', 50], ['pais', 'País', 50], ['cep', 'CEP', 9]].map(([key, label, max]) => <Input key={key} label={label} maxLength={max} value={modal.values[key]} onChange={value => field(key, value)} />)}
            <Input label="Total gasto demonstrativo (R$)" required type="number" min="0" max="999999999.99" step="0.01" value={modal.values.total_gasto} onChange={value => field('total_gasto', value)} />
          </div>
          <p className="help-text">Total gasto é informado apenas para demonstração, sem cálculo a partir de vendas.</p>
          <h3>Telefones multivalorados</h3>
          {modal.values.telefones.map((phone, index) => <div className="phone-row" key={index}>
            <Input label={`Telefone ${index + 1} (55 + DDD)`} required type="tel" maxLength={20} value={phone.numero} onChange={value => field('telefones', modal.values.telefones.map((item, i) => i === index ? { ...item, numero: value } : item))} />
            <label>Tipo<select value={phone.tipo || ''} onChange={event => field('telefones', modal.values.telefones.map((item, i) => i === index ? { ...item, tipo: event.target.value } : item))}><option value="">Não informado</option><option>Móvel</option><option>Fixo</option></select></label>
            <button type="button" className="text-button danger" onClick={() => field('telefones', modal.values.telefones.filter((_, i) => i !== index))}>Remover</button>
          </div>)}
          <button type="button" className="secondary small" onClick={() => field('telefones', [...modal.values.telefones, { numero: '', tipo: 'Móvel' }])}>+ Telefone</button>
          <h3>Perfil individual obrigatório</h3>
          <Input label="Interesses (separados por vírgula)" value={modal.values.interesses_texto} onChange={value => field('interesses_texto', value)} />
          <Input label="Preferências (separadas por vírgula)" value={modal.values.preferencias_texto} onChange={value => field('preferencias_texto', value)} />
          <p className="help-text">O perfil é criado junto com o cliente. Cada interesse ou preferência é armazenado em uma linha própria.</p>
        </>}
        {modal.type === 'employees' && <>
          <Input label="Nome do funcionário" required maxLength={100} value={modal.values.nome} onChange={value => field('nome', value)} />
          <label>Especialização<select disabled={modal.id !== null} value={modal.values.especializacao} onChange={event => { field('especializacao', event.target.value); field('ID_SUPERVISOR', ''); }}><option value="RESPONSAVEL_DIVULGACAO">Responsável divulgação</option><option value="ATENDENTE_WHATSAPP">Atendente WhatsApp</option></select></label>
          {modal.values.especializacao === 'RESPONSAVEL_DIVULGACAO' && <label>Supervisor (opcional)<select value={modal.values.ID_SUPERVISOR || ''} onChange={event => field('ID_SUPERVISOR', event.target.value)}><option value="">Sem supervisor</option>{responsible.filter(row => row.ID_FUNCIONARIO !== modal.id).map(row => <option key={row.ID_FUNCIONARIO} value={row.ID_RESPONSAVEL}>{row.nome}</option>)}</select></label>}
          <p className="help-text">Cada funcionário deve pertencer a exatamente uma especialização. A supervisão não pode formar ciclos.</p>
        </>}
        {modal.type === 'campaigns' && <>
          <Input label="Título da oferta" required maxLength={100} value={modal.values.titulo_oferta} onChange={value => field('titulo_oferta', value)} />
          <label>Mensagem<textarea required maxLength={4000} rows={4} value={modal.values.texto_mensagem} onChange={event => field('texto_mensagem', event.target.value)} /></label>
          <p className="help-text">Use {'{nome}'} para inserir o nome fantasia ou razão social do cliente.</p>
          <div className="form-grid">
            <label>Responsável divulgação<select required value={modal.values.ID_RESPONSAVEL} onChange={event => field('ID_RESPONSAVEL', event.target.value)}><option value="">Selecione</option>{responsible.map(row => <option key={row.ID_RESPONSAVEL} value={row.ID_RESPONSAVEL}>{row.nome}</option>)}</select></label>
            <label>Status<select value={modal.values.status} onChange={event => field('status', event.target.value)}><option>Ativo</option><option>Inativo</option></select></label>
            <label>Execução demonstrativa<select value={modal.values.envio_mensagens} onChange={event => {
              field('envio_mensagens', event.target.value);
              if (event.target.value === 'Cancelada') field('status', 'Inativo');
              if (event.target.value === 'Agendada') field('status', 'Ativo');
            }}><option>Rascunho</option><option>Agendada</option><option>Cancelada</option></select></label>
            {modal.values.envio_mensagens === 'Agendada' && <Input label="Data e hora local do agendamento" type="datetime-local" step="0.001" required value={modal.values.data_agendamento} onChange={value => field('data_agendamento', value)} />}
          </div>
          <h3>Canais obrigatórios (UTILIZA)</h3>
          <div className="selection-list">{data.channels.map(channel => <label className="checkbox" key={channel.ID_CANAL}><input type="checkbox" checked={modal.values.canais.includes(channel.ID_CANAL)} onChange={event => toggle('canais', channel.ID_CANAL, event.target.checked)} />{channel.nome}</label>)}</div>
          <h3>Público por interesse, preferência e gasto</h3>
          {filterFields(audienceFilter, setAudienceFilter)}
          <button type="button" className="secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const clients = await api(`clients?${new URLSearchParams(audienceFilter)}`); field('clientes', clients.map(client => client.CNPJ)); setNotice({ text: `${clients.length} cliente(s) selecionado(s).` }); }
            catch (error) { report(error); } finally { setBusy(false); }
          }}>Selecionar público pelos filtros</button>
          <p className="help-text">{modal.values.clientes.length} cliente(s) selecionado(s). Os filtros combinam E; a seleção fica gravada em RECEBE e não muda se o perfil for editado depois.</p>
          <div className="selection-list">{data.clients.map(client => <label className="checkbox" key={client.CNPJ}><input type="checkbox" checked={modal.values.clientes.includes(client.CNPJ)} onChange={event => toggle('clientes', client.CNPJ, event.target.checked)} />{client.razao_social} • {money(client.total_gasto)}</label>)}</div>
          <div className="demo-note">Exige ao menos um cliente e um canal. O agendador funciona com o servidor ligado. Peças são cadastradas separadamente após salvar a campanha.</div>
        </>}
        {modal.type === 'channels' && <>
          <Input label="Nome do canal" required maxLength={50} value={modal.values.nome} onChange={value => field('nome', value)} />
          <Input label="Tipo do canal" maxLength={50} value={modal.values.tipo} onChange={value => field('tipo', value)} />
        </>}
        {['pieces', 'publications'].includes(modal.type) && <label>Campanha<select required disabled={modal.type === 'pieces' && modal.id !== null} value={modal.values.ID_CAMPANHA} onChange={event => { field('ID_CAMPANHA', event.target.value); if (modal.type === 'publications') field('ID_CANAL', ''); }}><option value="">Selecione</option>{(modal.type === 'pieces' ? pendingCampaigns : data.campaigns).map(c => <option key={c.ID_CAMPANHA} value={c.ID_CAMPANHA}>{c.titulo_oferta}</option>)}</select></label>}
        {modal.type === 'pieces' && <>
          <Input label="Número da peça" type="number" min="1" step="1" required disabled={modal.id !== null} value={modal.values.numero_peca} onChange={value => field('numero_peca', value)} />
          <Input label="Tipo da peça" maxLength={50} value={modal.values.tipo} onChange={value => field('tipo', value)} />
          <Input label="Nome do arquivo" required maxLength={100} value={modal.values.nome_arquivo} onChange={value => field('nome_arquivo', value)} />
          <label>Formato<select value={modal.values.formato} onChange={event => field('formato', event.target.value)}><option>PNG</option><option>PDF</option><option>MP4</option></select></label>
          <p className="help-text">Cadastro de metadados somente; não há upload nem envio de arquivo. O número pode se repetir em campanhas diferentes.</p>
        </>}
        {modal.type === 'publications' && <>
          <label>Canal utilizado pela campanha<select required value={modal.values.ID_CANAL} onChange={event => field('ID_CANAL', event.target.value)}><option value="">Selecione</option>{data.channels.filter(channel => data.campaigns.find(c => c.ID_CAMPANHA === Number(modal.values.ID_CAMPANHA))?.canais.includes(channel.ID_CANAL)).map(channel => <option key={channel.ID_CANAL} value={channel.ID_CANAL}>{channel.nome}</option>)}</select></label>
          <Input label="Data de publicação UTC" type="date" required value={modal.values.data_publicacao} onChange={value => field('data_publicacao', value)} />
          <Input label="Horário UTC" type="time" step="1" required value={modal.values.horario} onChange={value => field('horario', value)} />
          <label>Conteúdo<textarea maxLength={10000} rows={4} value={modal.values.conteudo || ''} onChange={event => field('conteudo', event.target.value)} /></label>
        </>}
        {modal.type === 'interactions' && <>
          <label>Cliente e campanha simulada<select required value={modal.values.ID_CAMPANHA && modal.values.CNPJ_CLIENTE ? `${modal.values.ID_CAMPANHA}/${modal.values.CNPJ_CLIENTE}` : ''} onChange={event => {
            const [campaign, cnpj] = event.target.value.split('/');
            field('ID_CAMPANHA', campaign); field('CNPJ_CLIENTE', cnpj || '');
          }}><option value="">Selecione um recebimento simulado</option>{sent.map(row => <option key={keyOf('receives', row)} value={keyOf('receives', row)}>{row.cliente_nome} • {row.titulo_oferta}</option>)}</select></label>
          <label>Atendente WhatsApp<select required value={modal.values.ID_ATENDENTE} onChange={event => field('ID_ATENDENTE', event.target.value)}><option value="">Selecione</option>{attendants.map(row => <option key={row.ID_ATENDENTE} value={row.ID_ATENDENTE}>{row.nome}</option>)}</select></label>
          <Input label="Data e hora local da interação" type="datetime-local" step="0.001" required value={modal.values.data_hora} onChange={value => field('data_hora', value)} />
          <Input label="Tipo de interação" maxLength={50} value={modal.values.tipo_interacao} onChange={value => field('tipo_interacao', value)} />
          <Input label="Status da interação" required maxLength={30} value={modal.values.status} onChange={value => field('status', value)} />
          <p className="help-text">Cada resposta tem seu próprio ID; várias interações podem pertencer ao mesmo cliente e campanha. Atendimento e respostas são registrados manualmente.</p>
        </>}
        {modal.type === 'receives' && <>
          <Input label="Visualização demonstrativa (data e hora local)" type="datetime-local" step="0.001" value={modal.values.data_visualizacao} onChange={value => field('data_visualizacao', value)} />
          <p className="help-text">Campo opcional. Deixe vazio para remover. Não indica leitura real no WhatsApp; é um registro manual de demonstração.</p>
        </>}
        <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar registro'}</button></div>
      </form>
    </section></div>}
    {confirmation && <div className="modal-backdrop"><section className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirmation.title}</h2><p>{confirmation.detail}</p>{notice?.error && <div role="alert" className="notice error">{notice.text}</div>}<div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Voltar</button><button className="primary" disabled={busy} onClick={() => {
      const current = confirmation;
      act(async () => { await current.work(); setConfirmation(null); }, current.message);
    }}>{busy ? 'Processando...' : 'Confirmar'}</button></div></section></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
