import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const labels = { draft: 'Rascunho', scheduled: 'Agendada', completed: 'Simulação concluída', cancelled: 'Cancelada', pending: 'Sem resposta', interested: 'Interessado', not_interested: 'Sem interesse' };
const pages = [
  ['dashboard', 'Visão geral', '◈'], ['clients', 'Clientes', '♙'], ['segments', 'Segmentos', '▦'],
  ['materials', 'Materiais', '▤'], ['campaigns', 'Campanhas', '↗'], ['deliveries', 'Atendimento', '☏'],
  ['database', 'Banco de dados', '▥'],
];
const date = value => value ? new Date(value).toLocaleString('pt-BR') : 'Não agendada';
const badge = value => <span className={`badge ${value}`}>{labels[value] || value}</span>;
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Falha na solicitação.'), { status: response.status });
  return data;
}
const initial = type => ({
  clients: { name: '', phone: '', segment_id: '', consent: false, active: true },
  segments: { name: '', description: '' },
  materials: { title: '', message: '', image_url: '' },
  campaigns: { name: '', segment_id: '', material_id: '', status: 'draft', scheduled_at: '' },
  deliveries: { response: 'pending', notes: '' },
}[type]);

function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [data, setData] = useState({ clients: [], segments: [], materials: [], campaigns: [], deliveries: [], database: [], dashboard: null });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [login, setLogin] = useState({ username: '', password: '' });
  const [confirmation, setConfirmation] = useState(null);
  const report = error => {
    setNotice({ error: true, text: error.message });
    if (error.status === 401) { setUser(null); setModal(null); setConfirmation(null); }
  };
  async function reload() {
    setLoading(true);
    try {
      const keys = ['clients', 'segments', 'materials', 'campaigns', 'deliveries', 'dashboard', 'database'];
      const results = await Promise.all(keys.map(path => api(path)));
      setData(Object.fromEntries(keys.map((key, i) => [key, results[i]])));
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
  }, [user]);
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
  function open(type, row) {
    const values = row ? { ...row } : initial(type);
    if (type === 'clients' && row) { values.consent = Boolean(row.consent); values.active = Boolean(row.active); }
    if (type === 'campaigns' && values.scheduled_at) {
      const local = new Date(values.scheduled_at);
      values.scheduled_at = new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }
    setModal({ type, id: row?.id, values });
    setNotice(null);
  }
  const field = (key, value) => setModal(current => ({ ...current, values: { ...current.values, [key]: value } }));
  async function save(event) {
    event.preventDefault();
    const { type, id, values } = modal;
    const body = { ...values };
    if (type === 'campaigns' && body.status === 'scheduled') body.scheduled_at = new Date(body.scheduled_at).toISOString();
    await act(async () => {
      await api(`${type}${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', body);
      setModal(null);
    }, 'Registro salvo com sucesso.');
  }
  function confirm(title, detail, work, message) {
    setConfirmation({ title, detail, work, message });
  }
  const remove = (type, row) => confirm('Excluir registro?', `O cadastro "${row.name || row.title}" será excluído. Registros vinculados ao histórico não podem ser removidos.`,
    () => api(`${type}/${row.id}`, 'DELETE'), 'Registro excluído.');
  const changePage = next => { setPage(next); setSearch(''); setFilter(''); setNotice(null); };
  const rows = (page === 'dashboard' ? [] : data[page] || []).filter(row => {
    const matches = Object.values(row).some(value => String(value ?? '').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
    return matches && (!filter || (['clients', 'campaigns'].includes(page) ? String(row.segment_id) === filter : row.response === filter));
  });
  const controls = (type, row) => <div className="actions">
    <button className="secondary small" onClick={() => open(type, row)} disabled={busy}>Editar</button>
    <button className="text-button danger" onClick={() => remove(type, row)} disabled={busy}>Excluir</button>
  </div>;
  if (booting) return <main className="boot">Carregando central de campanhas...</main>;
  if (!user) return <main className="login-layout">
    <section className="login-story">
      <div className="brand"><span className="brand-mark">R</span><span>RSOUZA<small>AUTO PEÇAS</small></span></div>
      <span className="eyebrow">RELACIONAMENTO QUE MOVE NEGÓCIOS</span>
      <h1>A peça certa.<br />A mensagem certa.<br /><em>O cliente certo.</em></h1>
      <p>Organize seus contatos, planeje campanhas e acompanhe o interesse dos clientes em um só lugar.</p>
      <div className="story-tags"><span>Segmentação</span><span>Agendamento</span><span>Atendimento</span></div>
      <small>Projeto acadêmico • A R Souza Auto Peças</small>
    </section>
    <section className="login-panel"><form onSubmit={authenticate} className="login-card">
      <span className="eyebrow">CENTRAL DE CAMPANHAS</span><h2>Bem-vindo de volta</h2><p>Entre para gerenciar o relacionamento com seus clientes.</p>
      {notice && <div role="alert" className="notice error">{notice.text}</div>}
      <label>Usuário<input autoComplete="username" required value={login.username} onChange={event => setLogin({ ...login, username: event.target.value })} /></label>
      <label>Senha<input type="password" autoComplete="current-password" required maxLength={200} value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} /></label>
      <button className="primary" disabled={busy}>{busy ? 'Entrando...' : 'Entrar no sistema →'}</button>
      <div className="demo-note"><strong>Ambiente demonstrativo</strong><br />Não envia mensagens automaticamente. Utilize somente dados fictícios para apresentação.</div>
    </form></section>
  </main>;
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">R</span><span>RSOUZA<small>AUTO PEÇAS</small></span></div>
      <small className="nav-caption">CENTRAL DE CAMPANHAS</small>
      <nav aria-label="Menu principal">{pages.map(([key, title, icon]) => <button key={key} className={page === key ? 'nav-active' : ''} onClick={() => changePage(key)}><span aria-hidden="true">{icon}</span>{title}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" /> Modo demonstrativo<p>Organização real.<br />Envios simulados.</p></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>{user.company}</span><div><span className="avatar">A</span><span>{user.username}</span><button className="text-button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api('logout', 'POST'); setUser(null); setNotice(null); setModal(null); setConfirmation(null); }
        catch (error) { report(error); } finally { setBusy(false); }
      }}>Sair</button></div></header>
      <main className="content">
        <div className="demo-banner"><strong>DEMONSTRAÇÃO</strong><span>O agendamento gera registros simulados. Nenhuma mensagem é enviada pela API do WhatsApp.</span></div>
        <div className="page-heading"><div><span className="eyebrow">RELACIONAMENTO & CAMPANHAS</span><h1>{pages.find(([key]) => key === page)[1]}</h1><p>{{
          dashboard: 'Um panorama do relacionamento com seus clientes.',
          clients: 'Contatos organizados, com consentimento e segmentação.',
          segments: 'Agrupe clientes para tornar cada campanha mais relevante.',
          materials: 'Prepare mensagens promocionais para suas campanhas.',
          campaigns: 'Planeje ações e simule a distribuição para seu público.',
          deliveries: 'Registre respostas e continue a conversa pelo WhatsApp.',
          database: 'Consulta somente leitura dos dados reais persistidos no SQLite.',
        }[page]}</p></div>
          {['clients', 'segments', 'materials', 'campaigns'].includes(page) ? <button className="primary" disabled={busy} onClick={() => open(page)}>+ { { clients: 'Novo cliente', segments: 'Novo segmento', materials: 'Novo material', campaigns: 'Nova campanha' }[page]}</button> : <button className="secondary" disabled={loading} onClick={() => reload().catch(report)}>{loading ? 'Atualizando...' : '↻ Atualizar'}</button>}
        </div>
        {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice ${notice.error ? 'error' : 'success'}`}>{notice.text}</div>}
        {page === 'dashboard' && data.dashboard && <>
          <div className="stats">{[
            ['Clientes cadastrados', data.dashboard.clients, `${data.dashboard.eligible} ativos com consentimento`, '♙'],
            ['Campanhas', data.dashboard.campaigns, `${data.dashboard.scheduled} aguardando agendamento`, '↗'],
            ['Registros simulados', data.dashboard.simulations, 'Não são envios reais', '▤'],
            ['Clientes interessados', data.dashboard.interested, 'Respostas registradas manualmente', '♡'],
          ].map(([title, value, subtitle, icon]) => <article className="stat" key={title}><span className="stat-icon">{icon}</span><p>{title}</p><strong>{value}</strong><small>{subtitle}</small></article>)}</div>
          <div className="dashboard-grid"><section className="card"><div className="card-heading"><h2>Campanhas recentes</h2><button className="text-button" onClick={() => changePage('campaigns')}>Ver todas →</button></div><div className="table-scroll"><table><thead><tr><th>Campanha</th><th>Público</th><th>Situação</th></tr></thead><tbody>{data.dashboard.recent.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{date(row.scheduled_at)}</small></td><td>{row.segment_name}</td><td>{badge(row.status)}</td></tr>)}</tbody></table></div>{!data.dashboard.recent.length && <p className="empty">Nenhuma campanha cadastrada.</p>}</section>
            <section className="flow-card"><span className="eyebrow">SEU FLUXO DE TRABALHO</span><h2>Da campanha<br />à conversa.</h2><ol><li>Cadastre clientes e consentimento</li><li>Escolha um segmento e material</li><li>Agende ou simule a campanha</li><li>Registre respostas no atendimento</li></ol><button className="primary" onClick={() => { changePage('campaigns'); open('campaigns'); }}>Criar uma campanha →</button></section></div>
          <div className="privacy-card"><strong>Consentimento em primeiro lugar</strong><p>Apenas clientes ativos e com autorização participam das simulações. Telefones e nomes iniciais são fictícios; não representam contatos reais da empresa.</p></div>
        </>}
        {page === 'database' && <>
          <div className="privacy-card"><strong>Banco relacional SQLite</strong><p>Chaves estrangeiras habilitadas. Exibição dos 20 registros mais recentes de cada tabela, consultados diretamente pela API. Não é uma imagem estática.</p></div>
          {data.database.map(table => <section className="card database-table" key={table.name}>
            <div className="card-heading"><h2>{table.name}</h2><span className="badge">{table.count} registro(s)</span></div>
            <p className="help-text database-meta">{table.columns.map(column => `${column.name}${column.pk ? ' (PK)' : ''}`).join(' • ')}{table.foreignKeys.length > 0 && <><br />Relacionamentos: {table.foreignKeys.map(key => `${key.from} → ${key.table}.${key.to}`).join(' • ')}</>}</p>
            <div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{table.rows.map(row => <tr key={row.id}>{table.columns.map(column => <td className="database-cell" key={column.name}>{String(row[column.name] ?? 'NULL')}</td>)}</tr>)}</tbody></table></div>{!table.rows.length && <p className="empty">Tabela vazia.</p>}
          </section>)}
        </>}
        {!['dashboard', 'database'].includes(page) && <>
          <div className="toolbar"><input aria-label="Buscar registros" placeholder="Buscar por nome, mensagem ou telefone..." value={search} onChange={event => setSearch(event.target.value)} />
            {['clients', 'campaigns'].includes(page) && <select aria-label="Filtrar por segmento" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todos os segmentos</option>{data.segments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {page === 'deliveries' && <select aria-label="Filtrar por resposta" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Todas as respostas</option>{['pending', 'interested', 'not_interested'].map(key => <option key={key} value={key}>{labels[key]}</option>)}</select>}
            <span>{rows.length} registro(s)</span>
          </div>
          {page === 'materials' ? <div className="materials-grid">{rows.map(row => <article className="card material" key={row.id}><span className="eyebrow">MATERIAL PROMOCIONAL #{row.id}</span><h2>{row.title}</h2><div className="message-preview">{row.message}</div>{row.image_url && <a href={row.image_url} target="_blank" rel="noreferrer">Abrir imagem vinculada ↗</a>}{controls(page, row)}</article>)}</div> : <section className="card table-scroll"><table>
            <thead><tr>{{
              clients: ['Cliente', 'Telefone', 'Segmento', 'Consentimento', 'Situação', 'Ações'],
              segments: ['Segmento', 'Descrição', 'Clientes', 'Ações'],
              campaigns: ['Campanha / material', 'Segmento', 'Agendamento', 'Situação', 'Público', 'Ações'],
              deliveries: ['Cliente / campanha', 'Simulação', 'Resposta', 'Observação', 'Ações'],
            }[page].map(title => <th key={title}>{title}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              {page === 'clients' && <><td><strong>{row.name}</strong><small>#{row.id}</small></td><td>{row.phone}</td><td>{row.segment_name}</td><td><span className={`badge ${row.consent ? 'interested' : 'not_interested'}`}>{row.consent ? 'Autorizado' : 'Não autorizado'}</span></td><td>{row.active ? 'Ativo' : 'Inativo'}</td><td>{controls(page, row)}</td></>}
              {page === 'segments' && <><td><strong>{row.name}</strong></td><td>{row.description || '—'}</td><td>{row.client_count}</td><td>{controls(page, row)}</td></>}
              {page === 'campaigns' && <><td><strong>{row.name}</strong><small>{row.material_title}</small></td><td>{row.segment_name}</td><td>{date(row.scheduled_at)}</td><td>{badge(row.status)}</td><td>{row.status === 'completed' ? `${row.recipients} simulado(s)` : `${row.eligible} elegível(is)`}</td><td><div className="actions wrap">
                {['draft', 'scheduled'].includes(row.status) && <><button className="secondary small" disabled={busy} onClick={() => open(page, row)}>Editar</button><button className="primary small" disabled={busy} onClick={() => confirm('Simular campanha agora?', 'Serão criados registros demonstrativos para clientes ativos do segmento com consentimento. Isso conclui a campanha e NÃO envia mensagens reais.', () => api(`campaigns/${row.id}/simulate`, 'POST'), 'Simulação concluída. Consulte os registros em Atendimento.')}>Simular</button><button className="text-button danger" disabled={busy} onClick={() => confirm('Cancelar campanha?', 'O agendamento será interrompido. Nenhum registro de simulação será criado.', () => api(`campaigns/${row.id}/cancel`, 'POST'), 'Campanha cancelada.')}>Cancelar</button></>}
                {['draft', 'cancelled'].includes(row.status) && <button className="text-button danger" disabled={busy} onClick={() => remove(page, row)}>Excluir</button>}
                {row.status === 'completed' && <button className="text-button" onClick={() => { changePage('deliveries'); setSearch(row.name); }}>Ver registros →</button>}
              </div></td></>}
              {page === 'deliveries' && <><td><strong>{row.recipient_name}</strong><small>{row.campaign_name}</small><small>{row.recipient_phone}</small></td><td>{date(row.simulated_at)}<small>Registro simulado</small></td><td>{badge(row.response)}</td><td>{row.notes || '—'}</td><td><div className="actions wrap"><button className="secondary small" onClick={() => open(page, row)}>Registrar resposta</button>{row.consent && row.active ? <a className="whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${row.recipient_phone}?text=${encodeURIComponent(row.message)}`}>Abrir WhatsApp ↗</a> : <small>Contato inativo ou sem consentimento</small>}</div></td></>}
            </tr>)}</tbody>
          </table></section>}
          {!rows.length && <div className="empty card"><h2>Nenhum registro encontrado</h2><p>{page === 'deliveries' ? 'Simule uma campanha para gerar registros de atendimento.' : 'Cadastre um registro ou ajuste os filtros de busca.'}</p></div>}
          {page === 'deliveries' && <p className="help-text">“Abrir WhatsApp” prepara a mensagem; você precisa confirmar o envio no aplicativo. Não há confirmação de envio, entrega, leitura ou resposta pela API. Os números de exemplo são fictícios: não envie mensagens para eles.</p>}
        </>}
        <footer>RSouza • Sistema de campanhas promocionais • Projeto acadêmico</footer>
      </main>
    </div>
    {modal && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="card-heading"><h2 id="modal-title">{modal.type === 'deliveries' ? 'Registrar resposta' : `${modal.id ? 'Editar' : 'Cadastrar'} ${ { clients: 'cliente', segments: 'segmento', materials: 'material', campaigns: 'campanha' }[modal.type]}`}</h2><button className="text-button" aria-label="Fechar formulário" disabled={busy} onClick={() => setModal(null)}>✕</button></div>
      {notice?.error && <div role="alert" className="notice error">{notice.text}</div>}
      <form onSubmit={save}>
        {['clients', 'segments', 'campaigns'].includes(modal.type) && <label>Nome<input autoFocus required maxLength={modal.type === 'clients' ? 100 : modal.type === 'segments' ? 80 : 120} value={modal.values.name} onChange={event => field('name', event.target.value)} /></label>}
        {modal.type === 'clients' && <label>Telefone (55 + DDD + número)<input type="tel" required placeholder="5531999990000" value={modal.values.phone} onChange={event => field('phone', event.target.value)} /></label>}
        {['clients', 'campaigns'].includes(modal.type) && <label>Segmento<select required value={modal.values.segment_id} onChange={event => field('segment_id', event.target.value)}><option value="">Selecione um segmento</option>{data.segments.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        {modal.type === 'clients' && <><label className="checkbox"><input type="checkbox" checked={modal.values.consent} onChange={event => field('consent', event.target.checked)} />Cliente autorizou receber campanhas promocionais</label><label className="checkbox"><input type="checkbox" checked={modal.values.active} onChange={event => field('active', event.target.checked)} />Cadastro ativo</label><p className="help-text">Registre autorização somente quando houver consentimento. Para esta apresentação, utilize dados fictícios.</p></>}
        {modal.type === 'segments' && <label>Descrição<textarea maxLength={500} value={modal.values.description} onChange={event => field('description', event.target.value)} /></label>}
        {modal.type === 'materials' && <><label>Título<input autoFocus required maxLength={100} value={modal.values.title} onChange={event => field('title', event.target.value)} /></label><label>Mensagem<textarea required rows={6} maxLength={4000} value={modal.values.message} onChange={event => field('message', event.target.value)} /></label><p className="help-text">Use {'{nome}'} para personalizar a mensagem com o nome do cliente.</p><label>URL HTTPS da imagem (opcional)<input type="url" maxLength={2000} placeholder="https://..." value={modal.values.image_url} onChange={event => field('image_url', event.target.value)} /></label><p className="help-text">A imagem é incluída como link na mensagem, não como anexo enviado.</p></>}
        {modal.type === 'campaigns' && <><label>Material promocional<select required value={modal.values.material_id} onChange={event => field('material_id', event.target.value)}><option value="">Selecione um material</option>{data.materials.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Situação<select value={modal.values.status} onChange={event => field('status', event.target.value)}><option value="draft">Rascunho</option><option value="scheduled">Agendada</option></select></label>{modal.values.status === 'scheduled' && <label>Data e hora local<input type="datetime-local" required value={modal.values.scheduled_at} onChange={event => field('scheduled_at', event.target.value)} /></label>}<div className="demo-note">O servidor precisa estar ligado. Ao chegar a data, o sistema cria registros <strong>simulados</strong> somente para clientes ativos e autorizados. Agendamentos vencidos são processados ao reiniciar.</div></>}
        {modal.type === 'deliveries' && <><div className="message-preview">{modal.values.message}</div><label>Resposta informada manualmente<select value={modal.values.response} onChange={event => field('response', event.target.value)}>{['pending', 'interested', 'not_interested'].map(key => <option value={key} key={key}>{labels[key]}</option>)}</select></label><label>Observação<textarea maxLength={1000} value={modal.values.notes} onChange={event => field('notes', event.target.value)} /></label></>}
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
