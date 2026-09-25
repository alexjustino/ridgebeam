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
  'plan.lead':
    'As etapas em ordem, cada uma com suas atividades. A duração é contada em dias úteis; deixe-a vazia até saber.',
  'plan.people.title': 'Pessoas',
  'plan.people.description':
    'Uma pessoa é um nome, não uma conta. Qualquer pessoa adicionada aqui pode ser responsável por uma atividade.',
  'plan.people.empty': 'Ninguém ainda.',
  'plan.person.name': 'Nome da pessoa',
  'plan.person.add': 'Adicionar pessoa',
  'plan.stages.title': 'Etapas',
  'plan.stage.name': 'Nome da nova etapa',
  'plan.stage.add': 'Adicionar etapa',
  'plan.stage.remove': 'Remover etapa',
  'plan.stages.emptyTitle': 'Nenhuma etapa ainda',
  'plan.stages.emptyDescription':
    'Uma etapa é um capítulo da obra — demolição, instalações, revestimento. Adicione a primeira acima.',
  'plan.activities.empty': 'Nenhuma atividade nesta etapa ainda.',
  'plan.activity.newName': 'Nome da nova atividade em {stage}',
  'plan.activity.add': 'Adicionar atividade',
  'plan.column.activity': 'Atividade',
  'plan.column.duration': 'Duração (dias úteis)',
  'plan.column.responsible': 'Responsável',
  'plan.column.actions': 'Ações',
  'plan.activity.nameOf': 'Nome de {activity}',
  'plan.activity.durationOf': 'Duração de {activity}, em dias úteis',
  'plan.activity.responsibleOf': 'Responsável por {activity}',
  'plan.activity.notKnown': 'Ainda não definido',
  'plan.activity.remove': 'Remover',
  'plan.invalid.duration': 'A duração é um número inteiro de dias úteis, de 1 a {max}.',
  'plan.invalid.name': 'Um nome não pode ficar vazio.',
  'plan.refused': 'Essa alteração não foi guardada',
  'plan.confirm.stageTitle': 'Remover a etapa “{name}”?',
  'plan.confirm.stageEmpty': 'Ela não tem atividade. Isso não pode ser desfeito.',
  'plan.confirm.stageBody.one':
    'A {count} atividade dela é removida junto. Isso não pode ser desfeito.',
  'plan.confirm.stageBody.other':
    'As {count} atividades dela são removidas junto. Isso não pode ser desfeito.',
  'plan.confirm.activityTitle': 'Remover a atividade “{name}”?',
  'plan.confirm.activityBody':
    'A duração e o responsável dela vão junto. Isso não pode ser desfeito.',
  'plan.confirm.activityConfirm': 'Remover atividade',

  // ── Readiness and the figure ──────────────────────────────────────────────
  'readiness.label': 'Prontidão',
  'readiness.description': 'Quanto do que o plano precisa saber ele já sabe.',
  'readiness.complete': 'O plano sabe tudo o que precisa saber hoje.',
  'readiness.missing.activity.duration.one': '{count} atividade não tem duração.',
  'readiness.missing.activity.duration.other': '{count} atividades não têm duração.',
  'readiness.missing.activity.responsible.one': '{count} atividade não tem responsável.',
  'readiness.missing.activity.responsible.other': '{count} atividades não têm responsável.',
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
  'dashboard.finish.title': 'Data de término',
  'dashboard.finish.unknown': 'Ainda não se sabe — nenhuma atividade tem duração.',
  'dashboard.finish.invalidCalendar':
    'Ainda não se sabe — o calendário de trabalho não pode ser usado.',
  'dashboard.finish.invalidStart': 'Ainda não se sabe — a data de início não é um dia.',
  'dashboard.finish.leftOut.one': 'Não inclui {count} atividade sem duração.',
  'dashboard.finish.leftOut.other': 'Não inclui {count} atividades sem duração.',
  'dashboard.finish.sequential':
    'As atividades são postas uma depois da outra, etapa por etapa, a partir da data de início.',
  'dashboard.calendar.title': 'Calendário de trabalho',
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
  'settings.lens.note':
    'Guardada agora. As telas falam as palavras do dono hoje; as outras lentes passam a mudá-las numa versão seguinte.',
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
