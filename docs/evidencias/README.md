# Evidências do modelo refatorado — 01/11/2026

As capturas foram **substituídas** para representar o dicionário conciliado com o texto do MER. São telas da versão compilada realmente executada com React, API Express e SQLite. Todas as empresas, CNPJs, telefones, gastos, publicações e respostas são fictícios. A imagem original do MER ainda não foi disponibilizada.

## Arquivos

| Arquivo | Evidência |
| --- | --- |
| `01-login.png` | Login e aviso de dados fictícios |
| `02-visao-geral.png` | 3 empresas, 2 campanhas, 1 recebimento simulado e 1 interação |
| `03-cadastro-cliente.png` | CNPJ, razão social, nome fantasia, e-mail e endereço composto |
| `03b-perfil-telefones.png` | Telefones multivalorados e perfil obrigatório com interesses/preferências |
| `04-clientes.png` | Empresas e seus CNPJs, perfis e gastos demonstrativos |
| `04b-segmentacao.png` | Interesse Filtros + gasto mínimo 10.000 selecionando uma empresa |
| `05-funcionarios.png` | Responsáveis, supervisor recursivo e atendente especializado |
| `06-canais.png` | Canais de divulgação |
| `06b-pecas.png` | Peça fraca com chave composta (campanha, número) |
| `06c-publicacoes.png` | Duas publicações demonstrativas, uma por canal utilizado |
| `07-agendamento.png` | Campanha com responsável, status Ativo, execução Agendada e horário |
| `08-campanhas.png` | Campanha segmentada simulada e campanha futura agendada |
| `09-registro-interacao.png` | Registro manual com ID do atendente, data/hora, tipo e status |
| `10-recebimentos.png` | RECEBE com um Enviado (simulado), dois Pendentes e visualizações nulas |
| `10b-interacoes.png` | Interação persistida com cliente, campanha e atendente |
| `11-banco-preenchido.png` | Quinze tabelas preenchidas, chaves primárias e estrangeiras |
| `12-mobile.png` | Layout responsivo em 390 × 844 |
| `banco-demonstrativo.json` | Exportação somente leitura do SQLite usado nas capturas |
| `validacao.txt` | Resultado dos testes e compilação da versão refatorada |

As capturas desktop usam 1440 × 1000, exceto o login em 1280 × 742. Os formulários longos têm rolagem própria; as duas capturas do cliente mostram suas partes superior e inferior. Abra o PNG do banco em tamanho original e amplie para ler as tabelas. O controle nativo de data pode mostrar mês/dia conforme o navegador; a listagem usa português.

## Cenário reproduzível

Na inicialização nova: três empresas, três perfis, quatro telefones, quatro interesses, quatro preferências, três funcionários (dois responsáveis e um atendente), dois canais, uma campanha em rascunho com dois destinatários Pendentes e uma peça.

Pelo formulário, o nome fantasia da Garagem Horizonte foi alterado para “Horizonte — garagem demonstrativa”. O filtro **Filtros + gasto mínimo 10.000** retornou uma empresa.

Foi criada uma segunda campanha com responsável 2, interesse Filtros, preferência WhatsApp, gasto mínimo 10.000 e os canais WhatsApp Business e Catálogo digital. A seleção foi conferida no formulário: um cliente e dois canais. A campanha foi simulada, gerando um RECEBE Enviado e duas PUBLICACAO_CANAL.

Uma INTERACAO_WHATSAPP foi registrada para esse recebimento, com atendente 3 e status Interessado. Nenhuma visualização foi atribuída automaticamente; o botão WhatsApp gerou textos personalizados para os dois telefones do cliente, sem enviar mensagens. A primeira campanha foi agendada para **01/11/2026 às 23h no fuso local do navegador**.

O banco de evidências foi mantido separado do banco antigo migrado: `DATABASE_PATH=./data/evidencias-mer.sqlite`. O JSON não é importado automaticamente na instalação nova; reproduza os passos para obter o mesmo cenário.

## Roteiro de apresentação

1. Explique o problema: relacionamento comercial com garagens de ônibus, segmentação e campanhas programadas.
2. Entre no sistema e mostre clientes por CNPJ, endereço, vários telefones, perfil 1:1, interesses e preferências. Explique que total gasto é fictício informado, não calculado de vendas.
3. Mostre Funcionários: exatamente um subtipo por funcionário, supervisor opcional e responsável obrigatório em cada campanha.
4. Crie uma campanha, selecione responsável e canais. Aplique os filtros por interesse, preferência e faixa de gasto; confira os destinatários e salve.
5. Mostre a peça dependente da campanha e sua chave composta. Os arquivos são metadados, não anexos enviados.
6. Simule a campanha. Mostre RECEBE e PUBLICACAO_CANAL. Explique que Enviado significa simulado e não confirma envio real.
7. Registre uma interação com atendente, data/hora, tipo e status. Mostre que várias respostas podem ser cadastradas sem sobrescrever as anteriores.
8. Agende uma nova campanha para daqui a um minuto e mantenha o servidor ligado. Atualize a listagem após o agendador.
9. Abra Banco de dados e mostre as quinze tabelas, chaves compostas, FKs e dados reais consultados pela API. Reinicie e faça novo login para demonstrar persistência.
10. Apresente as limitações e a tabela de conciliação do README. Informe o uso de IA conforme as regras da disciplina.

## Validação adicional

Testes automatizados verificam segmentação combinada com limites inclusivos, chaves compostas, perfil obrigatório, especialização total/disjunta, ciclos de supervisão, atendente obrigatório, datas, canais utilizados e agendador por relógio real.

A migração do banco anterior também foi executada com backup integral e sem violações de FK; os testes verificam preservação de dados no backup e rollback diante de incompatibilidades. O JSON de evidências pertence ao cenário novo acima, não ao banco migrado.

A versão compilada foi reiniciada e acessada novamente: as três empresas, duas campanhas, um recebimento simulado e uma interação permaneceram disponíveis, com as quinze tabelas preenchidas.
