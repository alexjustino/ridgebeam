import type { Dictionary } from './en';

/**
 * Português do Brasil. Written as the interface would say it, not word for word from English;
 * the keys, and the `{variables}` inside each sentence, are exactly English's. The terms are the
 * glossary's Portuguese (`glossary.json`): obra, etapa, atividade, duração, responsável, dia útil,
 * prontidão, lente.
 */
export const ptBR: Dictionary = {
  // ── Common ────────────────────────────────────────────────────────────────
  'common.cancel': 'Cancelar',
  'common.working': 'Processando…',
  'common.yes': 'Sim',
  'common.no': 'Não',
  'common.on': 'Ligado',
  'common.off': 'Desligado',
  'common.hostSilent': 'O Ridgebeam não conseguiu ler isto',

  // ── Errors the host names by kind ─────────────────────────────────────────
  'errors.unexpected':
    'Algo deu errado na comunicação com o processo do Ridgebeam. Nada foi alterado. Os detalhes estão no log do aplicativo.',
  'errors.database': 'Não foi possível abrir ou gravar um banco de dados. Nada foi alterado.',
  'errors.dataDir': 'A pasta de dados do aplicativo não está disponível.',
  'errors.io': 'Não foi possível ler ou gravar a pasta. Confira se ela existe e se é sua.',
  'errors.workFolderNotEmpty':
    'Essa pasta não está vazia. Uma obra nova precisa de uma pasta vazia, ou de uma que ainda não exista.',
  'errors.workNotFound': 'Não há obra nessa pasta: ela não contém work.sqlite3.',
  'errors.workMoved':
    'A pasta da obra não está mais onde estava. Feche a obra e abra-a de onde ela está agora.',
  'errors.noWorkOpen': 'Nenhuma obra está aberta.',
  'errors.invalidInput': 'Isso não foi aceito: {detail}',
  'errors.settingsKey': 'Essa não é uma configuração que o Ridgebeam guarda.',

  // ── The shell ─────────────────────────────────────────────────────────────
  'shell.main': 'Principal',
  'shell.window.minimise': 'Minimizar',
  'shell.window.maximise': 'Maximizar',
  'shell.window.restore': 'Restaurar',
  'shell.window.close': 'Fechar',
  'shell.needsWork': 'Crie ou abra uma obra primeiro.',
  'shell.workClose': 'Fechar obra',
  'shell.workUnread': 'Não foi possível ler a obra aberta',

  'nav.dashboard': 'Painel',
  'nav.plan': 'Plano',
  'nav.settings': 'Configurações',
  'nav.diagnostics': 'Diagnóstico',
  'nav.about': 'Sobre',

  // ── Start ─────────────────────────────────────────────────────────────────
  'start.title': 'Início',
  'start.lead':
    'Uma obra é uma pasta no seu disco: o plano dela mora ali dentro, e nada sobre ela mora em outro lugar. Crie uma, ou abra uma que você já tem.',
  'start.new': 'Nova obra…',
  'start.open': 'Abrir obra…',
  'start.recent.title': 'Obras recentes',
  'start.recent.emptyTitle': 'Nenhuma obra aberta ainda',
  'start.recent.emptyDescription':
    'As obras que você criar ou abrir neste computador aparecem aqui, para que da próxima vez baste um clique.',
  'start.recent.unread': 'Não foi possível ler as obras recentes',
  'start.recent.opened': 'Aberta pela última vez em {when}',
  'start.recent.missing': 'A pasta não está mais aqui: {folder}',
  'start.recent.find': 'Abrir de onde ela está agora…',

  // ── The new-work and open-work dialogs ────────────────────────────────────
  'work.new.title': 'Nova obra',
  'work.new.lead':
    'O Ridgebeam cria a pasta, ou usa uma vazia, e guarda a obra inteira dentro dela.',
  'work.open.title': 'Abrir obra',
  'work.open.lead': 'Escolha a pasta que guarda a obra — a que contém work.sqlite3.',
  'work.field.name': 'Nome',
  'work.field.place': 'Local',
  'work.field.placeHint': 'Como você escreveria. Nunca é pesquisado e nunca sai deste computador.',
  'work.field.start': 'Data de início',
  'work.field.currency': 'Moeda',
  'work.field.workingDays': 'Dias úteis',
  'work.field.hours': 'Horas por dia útil',
  'work.field.folder': 'Pasta',
  'work.field.folderHintNew':
    'Uma pasta vazia, ou uma que ainda não exista. Escolha-a, ou digite ou cole o caminho.',
  'work.field.folderHintOpen': 'Escolha-a, ou digite ou cole o caminho.',
  'work.chooseFolder': 'Escolher pasta…',
  'work.create': 'Criar obra',
  'work.openSubmit': 'Abrir',
  'work.createRefused': 'A obra não foi criada',
  'work.openRefused': 'A obra não foi aberta',
  'work.invalid.name': 'Uma obra precisa de um nome.',
  'work.invalid.folder': 'Escolha uma pasta, ou digite o caminho dela.',
  'work.invalid.start': 'A data de início não é um dia do calendário.',
  'work.invalid.noWorkingDay':
    'Um calendário sem nenhum dia útil nunca poderia agendar nada. Marque pelo menos um dia.',
  'work.invalid.hours': 'As horas por dia útil são mais de 0 e no máximo 24.',
  'work.invalid.title': 'Algo aqui ainda não foi preenchido',
  'work.dialogUnavailable':
    'Não foi possível abrir a janela de pastas. Digite ou cole o caminho da pasta.',

  // ── Plan ──────────────────────────────────────────────────────────────────
  'plan.people.title': 'Pessoas',
  'plan.people.description':
    'Uma pessoa é um nome, não uma conta. Qualquer pessoa adicionada aqui pode ser responsável por uma atividade.',
  'plan.people.empty': 'Ninguém ainda.',
  'plan.person.name': 'Nome da pessoa',
  'plan.person.add': 'Adicionar pessoa',
  'plan.stages.emptyTitle': 'Nenhuma etapa ainda',
  'plan.stages.emptyDescription':
    'Uma etapa é um capítulo da obra — demolição, instalações, revestimento. Adicione a primeira acima.',
  'plan.activity.notKnown': 'Ainda não definido',
  'plan.invalid.duration': 'A duração é um número inteiro de dias úteis, de 1 a {max}.',
  'plan.invalid.name': 'Um nome não pode ficar vazio.',
  'plan.refused': 'Essa alteração não foi guardada',
  'plan.confirm.stageEmpty': 'Ela não tem atividade. Isso não pode ser desfeito.',
  'plan.confirm.stageBody.one':
    'A {count} atividade dela é removida junto. Isso não pode ser desfeito.',
  'plan.confirm.stageBody.other':
    'As {count} atividades dela são removidas junto. Isso não pode ser desfeito.',
  'plan.confirm.activityBody':
    'A duração e o responsável dela vão junto. Isso não pode ser desfeito.',

  // ── Plan: arrangements, rows and order (F1) ─────────────────────────────
  'shell.lensChosen': 'Lente: {lens}. As palavras de todas as telas a seguem.',
  'settings.lens.note':
    'As palavras de todas as telas, e a forma em que o plano abre. Nada de uma obra é guardado por lente: trocar de lente nunca muda um plano.',
  'plan.lead':
    'Três formas de ver as mesmas linhas. A estrutura é onde o plano é editado; as outras duas o mostram por onde acontece e como uma lista para seguir.',
  'plan.tabs': 'Formas de ver o plano',
  'plan.tab.breakdown': 'Estrutura',
  'plan.tab.byRoom': 'Por {room}',
  'plan.tab.checklist': 'Lista',
  'plan.fieldOf': '{field}: {name}',
  'plan.unit': 'Unidade',
  'plan.unitOf': 'Unidade: {name}',
  'plan.remove': 'Remover',
  'plan.removeNamed': 'Remover: {name}',
  'plan.rename': 'Renomear: {name}',
  'plan.add': 'Adicionar {what}',
  'plan.toAdd': '{what} a adicionar',
  'plan.toAddIn': '{what} a adicionar em {where}',
  'plan.move.up': 'Subir: {name}',
  'plan.move.down': 'Descer: {name}',
  'plan.move.hint':
    'Alt+Seta para cima e Alt+Seta para baixo movem a linha em foco, uma posição por vez.',
  'plan.move.done': '{name} agora é {number}.',
  'plan.move.alreadyFirst': '{name} já está no início.',
  'plan.move.alreadyLast': '{name} já está no fim.',
  'plan.column.duration': '{duration} (dias úteis)',
  'plan.activities.empty': 'Nada aqui ainda.',
  'plan.rooms.title': 'Onde a obra acontece',
  'plan.rooms.description':
    'As partes da obra — cozinha, banheiro, telhado. Cada linha do plano diz quais delas ela toca.',
  'plan.rooms.empty': 'Nada ainda.',
  'plan.rooms.noneYet': 'Ainda não há {room} no plano — adicione acima.',
  'plan.quantity.kept': 'Guardado: {amount}',
  'plan.invalid.quantity': 'Digite um número, 0 ou mais.',
  'plan.invalid.unitNeedsQuantity': 'A unidade espera um número — digite o número antes.',
  'plan.confirm.removeTitle': 'Remover “{name}”?',
  'plan.confirm.personNone': 'Nada no plano cita essa pessoa ainda. Isso não pode ser desfeito.',
  'plan.confirm.personBody.one':
    '{count} atividade pela qual essa pessoa responde ficará sem responsável, e a prontidão cai na mesma medida. Isso não pode ser desfeito.',
  'plan.confirm.personBody.other':
    '{count} atividades pelas quais essa pessoa responde ficarão sem responsável, e a prontidão cai na mesma medida. Isso não pode ser desfeito.',
  'plan.confirm.roomNone': 'Nenhuma linha do plano está marcada ali ainda.',
  'plan.confirm.roomBody.one':
    'A {count} atividade marcada ali continua no plano; só deixa de estar marcada ali.',
  'plan.confirm.roomBody.other':
    'As {count} atividades marcadas ali continuam no plano; só deixam de estar marcadas ali.',
  'plan.calendar.show': 'Editar',
  'plan.calendar.hide': 'Fechar',
  'plan.calendar.hours': '{hours} horas por dia útil',
  'plan.calendar.noHolidays': 'Nenhum feriado',
  'plan.calendar.holidays.one': '{count} feriado',
  'plan.calendar.holidays.other': '{count} feriados',
  'plan.calendar.badHoliday': '{date} não é um dia do calendário.',
  'plan.calendar.holidaysTitle': 'Feriados',
  'plan.calendar.holidayDay': 'Data do feriado',
  'plan.calendar.holidayName': 'Nome do feriado',
  'plan.calendar.holidayDate': 'Escolha a data do feriado antes.',
  'plan.calendar.holidayTwice': '{day} já está na lista.',
  'plan.calendar.notSaved': 'O calendário não foi salvo',
  'plan.calendar.save': 'Salvar calendário',
  'plan.calendar.saved': 'Salvo. A data de término acompanha.',
  'plan.calendar.unsaved': 'Alterações ainda não salvas.',
  'plan.byRoom.emptyTitle': 'Nada para organizar ainda',
  'plan.byRoom.emptyDescription':
    'Adicione etapas na estrutura e marque em cada linha onde ela acontece.',
  'plan.byRoom.none': 'Sem {room} ainda',
  'plan.byRoom.nothing': 'Nada marcado aqui ainda.',
  'plan.byRoom.alsoIn': 'também em {rooms}',
  'plan.editInBreakdown': 'Editar na estrutura',
  'plan.checklist.note':
    'A caixa é marcada pelo diário, a partir do dia em que ele chegar numa versão seguinte — nada é marcado como feito aqui.',
  'plan.checklist.days.one': '{count} dia útil',
  'plan.checklist.days.other': '{count} dias úteis',
  'plan.checklist.from': 'a partir de {day}',
  'plan.checklist.emptyTitle': 'Nada para listar ainda',
  'plan.checklist.emptyDescription':
    'Cada linha do plano vira uma linha aqui, na ordem em que o calendário a coloca.',

  // ── Schedule, links, baselines and slip (F2) ──────────────────────────────
  'nav.schedule': 'Cronograma',
  'errors.dependencyCycle': 'Isso formaria um ciclo — {detail}. Nada foi ligado.',
  'plan.links': 'Espera por',
  'plan.links.none': 'Nada ainda.',
  'plan.link.after': 'depois de {what}',
  'plan.link.lag': '+{lag} d',
  'plan.link.remove': 'Remover a ligação com {what}',
  'plan.link.stageOption': '{stage} {number} {name}',
  'plan.link.choose': 'Escolha…',
  'plan.link.blockerOf': 'O que {name} espera',
  'plan.link.lagOf': '{lag} de {name}, em dias úteis',
  'plan.link.add': 'Ligar',
  'plan.link.refused': 'Não ligado',
  'plan.link.cycle': 'Isso formaria um ciclo — {chain}. Nada foi ligado.',
  'plan.link.chooseFirst': 'Escolha antes o que ela espera.',
  'plan.invalid.lag': 'A espera é um número inteiro de dias úteis, de 0 a {max}.',
  'plan.stageLinks': 'Ligações da etapa inteira',
  'schedule.lead':
    'O plano posto sobre o calendário de trabalho: cada barra do início ao término, as ligações entre elas e o caminho crítico — a corrente em que um dia perdido é um dia perdido no fim.',
  'schedule.gantt': 'Gráfico de Gantt do cronograma',
  'schedule.bar': '{number} {name}, {days}, de {start} a {finish}',
  'schedule.bar.critical': '{number} {name}, {days}, de {start} a {finish}, no caminho crítico',
  'schedule.legend.critical': 'Caminho crítico: a barra mais escura com contorno grosso',
  'schedule.legend.plain': 'Demais atividades: uma barra simples',
  'schedule.legend.baseline': 'Linha de base: a barra mais clara por baixo',
  'schedule.legend.shaded': 'Sombreado: não é dia útil',
  'schedule.empty.title': 'Nada para pôr no cronograma ainda',
  'schedule.empty.description':
    'Dê uma duração às atividades na estrutura, e elas aparecem aqui no calendário.',
  'schedule.cyclic':
    'As ligações desta obra formam um ciclo, então ela não pode ser posta no cronograma. Remova uma delas na estrutura.',
  'schedule.inert.one':
    '{count} ligação aponta para uma etapa sem nada dentro, e ainda não muda nada.',
  'schedule.inert.other':
    '{count} ligações apontam para uma etapa sem nada dentro, e ainda não mudam nada.',
  'schedule.unplaced.title': 'Ainda fora do calendário',
  'schedule.approve': 'Aprovar o plano',
  'schedule.approve.note':
    'Aprovar guarda este cronograma como a primeira linha de base, para sempre: as mudanças seguintes são medidas contra ela, nunca escritas por cima.',
  'schedule.approve.cannot': 'Um plano pode ser aprovado quando puder ser posto no cronograma.',
  'schedule.approvedOn': 'Aprovado em {day}',
  'schedule.approved.note':
    'As mudanças depois da aprovação são medidas contra a linha de base. Uma nova linha de base, com o motivo dela, chega numa versão seguinte.',
  'schedule.approveRefused': 'O plano não foi aprovado',
  'schedule.critical.none': 'Ainda não há caminho crítico — nada está no calendário.',
  'schedule.critical.rows': 'O caminho crítico, em ordem',
  'slip.none': '0 dias',
  'slip.late.one': '{count} dia',
  'slip.late.other': '{count} dias',
  'slip.early.one': '{count} dia adiantado',
  'slip.early.other': '{count} dias adiantados',
  'slip.rows': 'O que mudou em relação à linha de base',
  'slip.row.moved': '{baseline} → {current}',
  'slip.row.removed': 'removida do plano',
  'slip.row.added': 'acrescentada depois da linha de base',
  'slip.row.unplaced': 'fora do calendário agora',
  'dashboard.baselineFinish': '{baseline} {number}: {day}',
  'dashboard.critical.one': '{label}: {count} atividade',
  'dashboard.critical.other': '{label}: {count} atividades',
  'dashboard.finish.scheduled':
    'Calculada a partir das durações e das ligações, no calendário de trabalho.',

  'schedule.slip.label': 'Atraso',
  'slip.row.placed': 'agora no calendário, terminando em {current}',
  'schedule.unplaced.noDuration': 'ainda sem duração',
  'schedule.unplaced.noStage': 'a etapa dela não está no plano',
  'schedule.unplaced.invalidCalendar': 'o calendário de trabalho não pode ser usado',
  'schedule.unplaced.invalidStart': 'a data de início não é um dia',
  'schedule.unplaced.cyclic': 'as ligações formam um ciclo',
  'dashboard.finish.cyclic': 'Ainda não se sabe — as ligações formam um ciclo.',
  // ── Decisions and readiness rule by rule (F3) ───────────────────────────
  'nav.decisions': 'Decisões',
  'decisions.title': 'Decisões',
  'decisions.none': 'Nada para decidir aqui ainda.',
  'decisions.column.lead': '{lead} (dias úteis)',
  'decisions.column.status': 'Situação',
  'decisions.newLead': '{lead} da nova, em dias úteis',
  'decisions.deadline.unknown': 'Ainda não se sabe — nada nesta etapa está no cronograma.',
  'decisions.status.due.one': 'Vence em {count} dia útil',
  'decisions.status.due.other': 'Vence em {count} dias úteis',
  'decisions.status.today': 'Vence hoje',
  'decisions.status.overdue.one': 'Atrasada há {count} dia útil',
  'decisions.status.overdue.other': 'Atrasada há {count} dias úteis',
  'decisions.status.made': 'Tomada em {day}',
  'decisions.status.unknown': 'Ainda sem prazo',
  'decisions.make': 'Marcar como tomada',
  'decisions.reopen': 'Reabrir',
  'decisions.make.title': 'Marcar “{name}” como tomada',
  'decisions.answer': 'O que foi decidido (opcional)',
  'decisions.answer.hint':
    'Até {max} caracteres, guardados com a decisão. Reabrir a decisão apaga o texto.',
  'decisions.answered': 'Decidido: {answer}',
  'decisions.warning.title': 'Já atrasada',
  'decisions.warning.body': '{lead} de prazo de entrega, mas {stage} começa em {left}.',
  'decisions.warning.started': '{lead} de prazo de entrega, mas {stage} começa hoje ou já começou.',
  'decisions.invalid.lead': 'O prazo de entrega é um número inteiro de dias úteis, de 0 a {max}.',
  'decisions.confirm.body':
    'O prazo de entrega e, se ela foi tomada, a resposta vão junto. Isso não pode ser desfeito.',
  'decisions.refused': 'Essa decisão não foi guardada',
  'decisions.lead':
    'O que há para decidir, e até quando: o último dia em que cada decisão ainda pode ser tomada, calculado a partir do cronograma e do prazo de entrega — nunca digitado. As atrasadas primeiro, as tomadas por último.',
  'decisions.empty.title': 'Nada para decidir ainda',
  'decisions.empty.description':
    'As decisões são adicionadas à sua etapa na estrutura do plano — qual piso, onde ficam as tomadas.',
  'decisions.leadTime': '{lead} de prazo de entrega',
  'decisions.list': 'Todas as decisões, as atrasadas primeiro',
  'readiness.rules': 'Regra por regra',
  'readiness.rule.line': '{label} · {known} de {mustKnow}',
  'readiness.rule.nothing': 'Nada falta aqui.',
  'readiness.rule.activity.duration': 'Durações',
  'readiness.rule.activity.responsible': 'Responsáveis',
  'readiness.rule.activity.linked': 'Ligações',
  'readiness.rule.decision.deadline': 'Decisões com prazo',
  'readiness.rule.decision.timely': 'Decisões em dia',
  'readiness.rule.plan.activity': 'O próprio plano',
  'readiness.explanation.activity.duration': 'Sem duração nada entra no cronograma.',
  'readiness.explanation.activity.responsible':
    'Um trabalho sem responsável é um trabalho que ninguém combinou de fazer.',
  'readiness.explanation.activity.linked':
    'Uma atividade sem ligação é posta no primeiro dia, seja isso verdade ou não.',
  'readiness.explanation.decision.deadline':
    'Uma decisão cuja etapa não está no cronograma não tem um último dia para ser tomada.',
  'readiness.explanation.decision.timely':
    'Uma decisão tomada tarde segura a etapa que precisa dela.',
  'readiness.missing.decision.deadline.one': '{count} decisão ainda não tem prazo.',
  'readiness.missing.decision.deadline.other': '{count} decisões ainda não têm prazo.',
  'readiness.missing.decision.timely.one': '{count} decisão está atrasada.',
  'readiness.missing.decision.timely.other': '{count} decisões estão atrasadas.',
  'readiness.row.decision.deadline': 'ainda sem prazo',
  'readiness.row.decision.timely': 'atrasada',
  'decisions.due.label': 'Decisões a vencer',
  'decisions.due.value.one': '{count} decisão',
  'decisions.due.value.other': '{count} decisões',
  'decisions.due.none': 'Nenhuma',
  'decisions.due.hint': 'Atrasadas, ou vencendo nos próximos {days}.',
  'decisions.due.rows': 'As decisões que ele conta',

  // ── Readiness and the figure ──────────────────────────────────────────────
  'readiness.label': 'Prontidão',
  'readiness.description': 'Quanto do que o plano precisa saber ele já sabe.',
  'readiness.complete': 'O plano sabe tudo o que precisa saber hoje.',
  'readiness.missing.activity.duration.one': '{count} atividade não tem duração.',
  'readiness.missing.activity.duration.other': '{count} atividades não têm duração.',
  'readiness.missing.activity.responsible.one': '{count} atividade não tem responsável.',
  'readiness.missing.activity.responsible.other': '{count} atividades não têm responsável.',
  'readiness.missing.activity.linked.one': '{count} atividade não está ligada a nenhuma outra.',
  'readiness.missing.activity.linked.other':
    '{count} atividades não estão ligadas a nenhuma outra.',
  'readiness.row.activity.linked': 'sem ligação',
  'readiness.missing.plan.activity.one': 'O plano ainda não tem nenhuma atividade.',
  'readiness.missing.plan.activity.other': 'O plano ainda não tem nenhuma atividade.',
  'readiness.row.activity.duration': 'sem duração',
  'readiness.row.activity.responsible': 'sem responsável',
  'readiness.row.plan.activity': 'o plano não tem atividade',
  'figure.percent': '{value} %',
  'figure.opens': 'Pressione para ver o que ele conta.',
  'figure.closes': 'Pressione de novo para fechar a lista.',
  'figure.nothing': 'Não há nada nele para listar.',
  'figure.rows': 'O que o plano ainda não sabe',
  'figure.broken': 'Este número não confere com as suas linhas, então nenhum número é mostrado.',

  // ── Dashboard ─────────────────────────────────────────────────────────────
  'dashboard.lead': 'A obra num relance. Cada número abre as linhas de onde veio.',
  'dashboard.finish.unknown': 'Ainda não se sabe — nenhuma atividade tem duração.',
  'dashboard.finish.invalidCalendar':
    'Ainda não se sabe — o calendário de trabalho não pode ser usado.',
  'dashboard.finish.invalidStart': 'Ainda não se sabe — a data de início não é um dia.',
  'dashboard.finish.leftOut.one': 'Não inclui {count} atividade sem duração.',
  'dashboard.finish.leftOut.other': 'Não inclui {count} atividades sem duração.',
  'dashboard.calendar.start': 'Começa em',
  'dashboard.calendar.days': 'Dias úteis',
  'dashboard.calendar.hours': 'Horas por dia útil',
  'dashboard.calendar.holidays': 'Feriados',
  'dashboard.calendar.noHolidays': 'Nenhum',
  'dashboard.calendar.unreadable': 'Este calendário não pode ser lido.',
  'dashboard.currency': 'Moeda',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.lead':
    'Guardadas neste computador, no banco de dados do próprio Ridgebeam, e em nenhum outro lugar.',
  'settings.appearance.title': 'Aparência',
  'settings.appearance.description': 'Claro, escuro, ou o que o Windows estiver usando.',
  'settings.theme': 'Tema',
  'settings.theme.system': 'Seguir o Windows',
  'settings.theme.light': 'Claro',
  'settings.theme.dark': 'Escuro',
  'settings.language.title': 'Idioma',
  'settings.language.description':
    'As palavras de todas as telas. Cada idioma aparece com o próprio nome, para que você encontre o seu a partir de qualquer um.',
  'settings.language': 'Idioma',
  'settings.language.system': 'Idioma do Windows',
  'settings.language.showing': 'Na tela agora: {language}.',
  'settings.lens.title': 'Lente',
  'settings.lens.description':
    'A mesma obra nas palavras do dono, do arquiteto ou do engenheiro. A lente muda as palavras e a disposição, nunca os dados.',
  'settings.lens': 'Lente',
  'settings.lens.owner': 'Dono',
  'settings.lens.architect': 'Arquiteto',
  'settings.lens.engineer': 'Engenheiro',
  'settings.refused': 'A escolha não foi guardada',
  'settings.unread': 'Estas são as escolhas padrão',

  // ── Diagnostics ───────────────────────────────────────────────────────────
  'diagnostics.lead': 'O que o produto afirma, mostrado em vez de só afirmado.',
  'diagnostics.app.title': 'Este aplicativo',
  'diagnostics.app.description': 'Lido do programa em execução, nunca de uma constante.',
  'diagnostics.version': 'Versão',
  'diagnostics.platform': 'Plataforma',
  'diagnostics.dataDir': 'Dados do aplicativo',
  'diagnostics.database': 'Banco de dados',
  'diagnostics.schema': 'Versão do esquema',
  'diagnostics.relocated': 'Realocado',
  'diagnostics.relocatedNote':
    'Os dados do aplicativo foram realocados por RIDGEBEAM_DATA_DIR — esta não é a pasta de costume.',
  'diagnostics.accent': 'Cor de destaque',
  'diagnostics.accentSystem': 'Lida do Windows',
  'diagnostics.accentDefault': 'A padrão embutida — não foi possível consultar o Windows',
  'diagnostics.work.title': 'A obra aberta',
  'diagnostics.work.description': 'A pasta e o banco de dados de onde o plano é lido.',
  'diagnostics.folder': 'Pasta',
  'diagnostics.journal': 'Modo do journal',
  'diagnostics.synchronous': 'Sincronização',
  'diagnostics.foreignKeys': 'Chaves estrangeiras',

  // ── About ─────────────────────────────────────────────────────────────────
  'about.title': 'Sobre o Ridgebeam',
  'about.lead':
    'Um planejador de obras para o engenheiro, o arquiteto e quem constrói uma vez só. Ele roda neste computador e em nenhum outro lugar.',
  'about.name.title': 'O nome',
  'about.name.story':
    'Ridge beam é como se diz, em inglês, a cumeeira: a viga no alto do telhado de duas águas, onde os caibros se encontram — a peça mais alta da estrutura de uma casa, e a última a subir. O dia em que ela sobe tem nome próprio no Brasil: o dono oferece a festa da cumeeira à equipe, porque a partir daquele dia a casa tem forma. Ela só sobe porque tudo embaixo dela foi planejado antes, e é para isso que o Ridgebeam existe.',
  'about.build.title': 'Esta versão',
  'about.build.description': 'Lido do programa em execução, nunca de uma constante digitada à mão.',
  'about.build.version': 'Versão',
  'about.build.commit': 'Commit',
  'about.build.date': 'Compilada em',
  'about.licence.title': 'Autor e licença',
  'about.licence.author': 'Feito por Alex Justino.',
  'about.licence.body':
    'Copyright 2026 Alex Justino. Licenciado sob a Apache License 2.0: você pode usar, modificar e redistribuir este software nos termos dela; uma cópia redistribuída mantém o aviso e informa que foi modificada.',
  'about.licence.trademark':
    'Ridgebeam é uma marca de Alex Justino. A licença cobre o código-fonte; ela não dá permissão para usar o nome ou a marca para endossar ou promover produtos derivados.',
  'about.licence.repository': 'Código-fonte',
  'about.licence.copy': 'Copiar o endereço',
  'about.licence.copied': 'Copiado',
  'about.licence.copyFailed':
    'Não foi possível copiar o endereço. Selecione-o e copie manualmente.',
  'about.data.title': 'Seus dados',
  'about.data.body':
    'O Ridgebeam não faz nenhuma requisição de rede. Não há conta, sincronização, análise de uso, relatório de falhas nem verificação de atualização. Uma obra mora na pasta que você escolheu, e nada dela sai deste computador.',
  'about.data.folder': 'As escolhas do próprio Ridgebeam e a lista de obras recentes ficam em:',
  'about.credits.title': 'Construído sobre',
  'about.credits.description':
    'Lido do arquivo NOTICE que acompanha o programa, para que esta lista não se afaste dele.',
  'about.credits.none':
    'O NOTICE ainda não lista nenhum componente de terceiros. Cada um é acrescentado quando é adotado, a partir dos manifestos de dependências.',
  'about.credits.unread': 'Não foi possível ler a lista de terceiros do NOTICE.',
};
