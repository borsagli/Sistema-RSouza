# Evidências de funcionamento e roteiro de apresentação

Capturas feitas em **31/10/2026**, executando o projeto em um navegador real, em resolução desktop 1440 × 1000 e móvel 390 × 844. Os registros foram criados pela aplicação e consultados no SQLite, não desenhados como telas estáticas. Todos os contatos e respostas são fictícios.

## Arquivos

| Arquivo | Evidência |
| --- | --- |
| `01-login.png` | Tela de autenticação |
| `02-visao-geral.png` | Indicadores consultados pela API: 5 clientes, 2 campanhas, 3 simulações e 1 interessado |
| `03-cadastro-cliente.png` | Formulário preenchido, segmentação e consentimento |
| `04-clientes.png` | Cliente salvo e listagem com um contato sem autorização |
| `05-segmentos.png` | Segmentos com contagem dos clientes vinculados |
| `06-materiais.png` | Mensagens promocionais e personalização |
| `07-agendamento.png` | Formulário de campanha com data futura e aviso de simulação |
| `08-campanhas.png` | Campanha agendada e outra concluída com 3 registros simulados |
| `09-registro-resposta.png` | Mensagem personalizada e resposta manual |
| `10-atendimento.png` | Resposta persistida e links de abertura manual do WhatsApp |
| `11-banco-preenchido.png` | Cinco tabelas preenchidas, chaves primárias e estrangeiras |
| `12-mobile.png` | Painel responsivo em tela de celular |
| `banco-demonstrativo.json` | Consulta somente leitura dos dados usados nas capturas |
| `validacao.txt` | Saída dos testes automatizados e da compilação |

Abra os PNGs individualmente para vê-los em resolução original. A captura do banco é longa: amplie a imagem para ler cada tabela. As datas são exibidas no fuso local do navegador; o JSON armazena UTC. O controle de data nativo pode usar o formato visual do navegador (mês/dia), mas a campanha salva aparece formatada em português na listagem.

## Roteiro de demonstração (aproximadamente 5 minutos)

1. Execute o projeto seguindo o README principal e entre no painel. Explique que React renderiza o front-end, Express fornece a API e SQLite mantém os dados.
2. Mostre Segmentos e Materiais. Explique que cada campanha referencia um segmento e um material por chaves estrangeiras.
3. Cadastre um cliente fictício com DDD + telefone, segmento e consentimento. Mostre o cadastro na listagem. Sem consentimento, ele não participa das campanhas.
4. Crie uma campanha em rascunho, escolha o público e o material. Clique em Simular e confirme. Veja os registros em Atendimento.
5. Registre uma resposta fictícia como Interessado e uma observação. Volte ao painel para mostrar os indicadores atualizados.
6. Crie outra campanha agendada para daqui a um minuto, mantenha o servidor ligado e aguarde o agendador. Clique em Atualizar para mostrar sua conclusão automática em modo demonstrativo.
7. Abra Banco de dados, mostre as cinco tabelas e os relacionamentos. Recarregue a página ou reinicie o servidor (faça novo login) para demonstrar persistência.
8. Explique o botão WhatsApp sem enviar mensagens a números fictícios: ele prepara a mensagem, mas o envio é manual. Não há robô, API oficial, confirmação de entrega ou recebimento automático de respostas.

## Cenário das capturas

Na primeira execução foram criados 3 segmentos, 4 clientes, 2 materiais e 1 campanha em rascunho. Pelo formulário foi incluída a Oficina Estrela (fictícia), totalizando 5 clientes. A campanha das oficinas foi simulada para 3 clientes autorizados; o cliente sem consentimento foi excluído automaticamente da seleção. Uma dessas respostas foi marcada como Interessado. A segunda campanha foi agendada para 01/11/2026 às 14h no fuso do navegador usado na captura.

Uma instalação nova recebe somente os cadastros iniciais: reproduza os passos acima para obter o mesmo cenário, ou consulte o JSON de evidência. O JSON não é automaticamente importado no banco. Não há banco binário com dados de usuários versionado.

A versão compilada também foi executada após reiniciar o servidor: os 5 clientes, 3 simulações e 1 interessado continuaram disponíveis no mesmo SQLite. O teste automatizado de agendamento inicia outro servidor com banco temporário e confirma a conclusão pelo relógio real, sem acionar o botão Simular.

## Limites acadêmicos

Estas evidências comprovam o funcionamento do **sistema demonstrativo**, não de uma integração real de WhatsApp. A aceitação desse escopo depende dos critérios do professor. Os PDFs originais não estavam anexados à sessão de implementação; confira a correspondência com a modelagem das atividades anteriores antes da entrega. Informe o uso de IA conforme as regras da disciplina.
