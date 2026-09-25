/**
 * English: the product's own voice, and the source every other dictionary is checked against.
 *
 * `MessageKey` is derived from this object, so a key a component asks for that is not here is a
 * type error, and a key missing from `pt-BR` is both a type error there and a failing test
 * (`dictionaries.test.ts`). `{name}` is an interpolation variable; a translation carries exactly
 * the same ones. A sentence about a count is two keys, `<base>.one` and `<base>.other`, chosen by
 * the language's plural rule (`pluralKey` in `index.ts`).
 *
 * The terms — work, stage, activity, duration, responsible, working day, readiness, lens — are the
 * glossary's (`glossary.json`), in the same words, so a screen never says one thing and the
 * glossary another.
 */
export const en = {
  // ── Common ────────────────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.working': 'Working…',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.on': 'On',
  'common.off': 'Off',
  'common.hostSilent': 'Ridgebeam could not read this',

  // ── Errors the host names by kind ─────────────────────────────────────────
  'errors.unexpected':
    'Something went wrong talking to Ridgebeam’s own process. Nothing was changed. The details are in the application log.',
  'errors.database': 'A database could not be opened or written. Nothing was changed.',
  'errors.dataDir': 'The application data folder is not available.',
  'errors.io': 'The folder could not be read or written. Check that it exists and is yours.',
  'errors.workFolderNotEmpty':
    'That folder is not empty. A new work needs an empty folder, or one that does not exist yet.',
  'errors.workNotFound': 'There is no work in that folder: it holds no work.sqlite3.',
  'errors.workMoved':
    'The work’s folder is no longer where it was. Close the work, then open it from where it is now.',
  'errors.noWorkOpen': 'No work is open.',
  'errors.invalidInput': 'That was not accepted: {detail}',
  'errors.settingsKey': 'That is not a setting Ridgebeam keeps.',

  // ── The shell ─────────────────────────────────────────────────────────────
  'shell.main': 'Main',
  'shell.window.minimise': 'Minimise',
  'shell.window.maximise': 'Maximise',
  'shell.window.restore': 'Restore',
  'shell.window.close': 'Close',
  'shell.needsWork': 'Create or open a work first.',
  'shell.workClose': 'Close work',
  'shell.workUnread': 'The open work could not be read',

  'nav.dashboard': 'Dashboard',
  'nav.plan': 'Plan',
  'nav.settings': 'Settings',
  'nav.diagnostics': 'Diagnostics',
  'nav.about': 'About',

  // ── Start ─────────────────────────────────────────────────────────────────
  'start.title': 'Start',
  'start.lead':
    'A work is a folder on your disk: its plan lives inside it, and nothing about it lives anywhere else. Create one, or open one you already have.',
  'start.new': 'New work…',
  'start.open': 'Open work…',
  'start.recent.title': 'Recent works',
  'start.recent.emptyTitle': 'No work opened yet',
  'start.recent.emptyDescription':
    'The works you create or open on this machine are listed here, so the next time is one press.',
  'start.recent.unread': 'The recent works could not be read',
  'start.recent.opened': 'Last opened {when}',
  'start.recent.missing': 'The folder is no longer here: {folder}',
  'start.recent.find': 'Open from where it is now…',

  // ── The new-work and open-work dialogs ────────────────────────────────────
  'work.new.title': 'New work',
  'work.new.lead':
    'Ridgebeam creates the folder, or uses an empty one, and keeps the whole work inside it.',
  'work.open.title': 'Open work',
  'work.open.lead': 'Choose the folder that holds the work — the one with work.sqlite3 in it.',
  'work.field.name': 'Name',
  'work.field.place': 'Place',
  'work.field.placeHint':
    'As you would write it. It is never looked up and never leaves this machine.',
  'work.field.start': 'Start date',
  'work.field.currency': 'Currency',
  'work.field.workingDays': 'Working days',
  'work.field.hours': 'Hours per working day',
  'work.field.folder': 'Folder',
  'work.field.folderHintNew':
    'An empty folder, or one that does not exist yet. Choose it, or type or paste its path.',
  'work.field.folderHintOpen': 'Choose it, or type or paste its path.',
  'work.chooseFolder': 'Choose folder…',
  'work.create': 'Create work',
  'work.openSubmit': 'Open',
  'work.createRefused': 'The work was not created',
  'work.openRefused': 'The work was not opened',
  'work.invalid.name': 'A work needs a name.',
  'work.invalid.folder': 'Choose a folder, or type its path.',
  'work.invalid.start': 'The start date is not a day on the calendar.',
  'work.invalid.noWorkingDay':
    'A calendar with no working day could never schedule anything. Tick at least one day.',
  'work.invalid.hours': 'Hours per working day are more than 0 and at most 24.',
  'work.invalid.title': 'Some of this is not filled in yet',
  'work.dialogUnavailable':
    'The folder dialog could not be opened. Type or paste the folder’s path instead.',

  // ── Plan ──────────────────────────────────────────────────────────────────
  'plan.people.title': 'People',
  'plan.people.description':
    'A person is a name, not an account. Anyone added here can be made responsible for an activity.',
  'plan.people.empty': 'Nobody yet.',
  'plan.person.name': 'Name of the person',
  'plan.person.add': 'Add person',
  'plan.stages.emptyTitle': 'No stage yet',
  'plan.stages.emptyDescription':
    'A stage is a chapter of the work — demolition, rough-in, tiling. Add the first one above.',
  'plan.activity.notKnown': 'Not yet known',
  'plan.invalid.duration': 'A duration is a whole number of working days, from 1 to {max}.',
  'plan.invalid.name': 'A name cannot be empty.',
  'plan.refused': 'That change was not kept',
  'plan.confirm.stageEmpty': 'It has no activity. This cannot be undone.',
  'plan.confirm.stageBody.one': 'Its {count} activity is removed with it. This cannot be undone.',
  'plan.confirm.stageBody.other':
    'Its {count} activities are removed with it. This cannot be undone.',
  'plan.confirm.activityBody':
    'Its duration and its responsible go with it. This cannot be undone.',

  // ── Plan: arrangements, rows and order (F1) ─────────────────────────────
  'shell.lensChosen': 'Lens: {lens}. The words on every screen follow it.',
  'settings.lens.note':
    'The words on every screen, and the arrangement the plan opens on. Nothing about a work is kept per lens: switching never changes a plan.',
  'plan.lead':
    'Three arrangements of the same rows. The breakdown is where the plan is edited; the other two show it by where it happens and as a list to follow.',
  'plan.tabs': 'Arrangements of the plan',
  'plan.tab.breakdown': 'Breakdown',
  'plan.tab.byRoom': 'By {room}',
  'plan.tab.checklist': 'Checklist',
  'plan.fieldOf': '{field}: {name}',
  'plan.unit': 'Unit',
  'plan.unitOf': 'Unit: {name}',
  'plan.remove': 'Remove',
  'plan.removeNamed': 'Remove: {name}',
  'plan.rename': 'Rename: {name}',
  'plan.add': 'Add {what}',
  'plan.toAdd': '{what} to add',
  'plan.toAddIn': '{what} to add in {where}',
  'plan.move.up': 'Move up: {name}',
  'plan.move.down': 'Move down: {name}',
  'plan.move.hint': 'Alt+Up and Alt+Down move the row that has the focus, one place at a time.',
  'plan.move.done': '{name} is now {number}.',
  'plan.move.alreadyFirst': '{name} is already first.',
  'plan.move.alreadyLast': '{name} is already last.',
  'plan.column.duration': '{duration} (working days)',
  'plan.activities.empty': 'Nothing here yet.',
  'plan.rooms.title': 'Where the work happens',
  'plan.rooms.description':
    'The parts of the work — kitchen, bathroom, roof. Each row of the plan says which ones it touches.',
  'plan.rooms.empty': 'Nothing yet.',
  'plan.rooms.noneYet': 'There is no {room} in the plan yet — add one above.',
  'plan.quantity.kept': 'Kept: {amount}',
  'plan.invalid.quantity': 'Enter a number, 0 or more.',
  'plan.invalid.unitNeedsQuantity': 'A unit waits for an amount — enter the number first.',
  'plan.confirm.removeTitle': 'Remove “{name}”?',
  'plan.confirm.personNone': 'Nothing in the plan names them yet. This cannot be undone.',
  'plan.confirm.personBody.one':
    '{count} activity they answer for will be left with no responsible, and readiness will drop by as much. This cannot be undone.',
  'plan.confirm.personBody.other':
    '{count} activities they answer for will be left with no responsible, and readiness will drop by as much. This cannot be undone.',
  'plan.confirm.roomNone': 'No row of the plan is marked there yet.',
  'plan.confirm.roomBody.one':
    'The {count} activity marked there stays in the plan; it is just no longer marked there.',
  'plan.confirm.roomBody.other':
    'The {count} activities marked there stay in the plan; they are just no longer marked there.',
  'plan.calendar.show': 'Edit',
  'plan.calendar.hide': 'Close',
  'plan.calendar.hours': '{hours} hours per working day',
  'plan.calendar.noHolidays': 'No holidays',
  'plan.calendar.holidays.one': '{count} holiday',
  'plan.calendar.holidays.other': '{count} holidays',
  'plan.calendar.badHoliday': '{date} is not a day on the calendar.',
  'plan.calendar.holidaysTitle': 'Holidays',
  'plan.calendar.holidayDay': 'Holiday date',
  'plan.calendar.holidayName': 'Holiday name',
  'plan.calendar.holidayDate': 'Choose the holiday’s date first.',
  'plan.calendar.holidayTwice': '{day} is already on the list.',
  'plan.calendar.notSaved': 'The calendar was not saved',
  'plan.calendar.save': 'Save calendar',
  'plan.calendar.saved': 'Saved. The finish date follows it.',
  'plan.calendar.unsaved': 'Changes not saved yet.',
  'plan.byRoom.emptyTitle': 'Nothing to arrange yet',
  'plan.byRoom.emptyDescription':
    'Add stages in the breakdown, and mark on each row where it happens.',
  'plan.byRoom.none': 'No {room} yet',
  'plan.byRoom.nothing': 'Nothing is marked here yet.',
  'plan.byRoom.alsoIn': 'also in {rooms}',
  'plan.editInBreakdown': 'Edit in the breakdown',
  'plan.checklist.note':
    'The box is ticked by the diary, from the day it arrives in a later version — nothing is marked done here.',
  'plan.checklist.days.one': '{count} working day',
  'plan.checklist.days.other': '{count} working days',
  'plan.checklist.from': 'from {day}',
  'plan.checklist.emptyTitle': 'Nothing to list yet',
  'plan.checklist.emptyDescription':
    'Each row of the plan becomes a line here, in the order the calendar places it.',

  // ── Readiness and the figure ──────────────────────────────────────────────
  'readiness.label': 'Readiness',
  'readiness.description': 'How much of what the plan must know, it does know.',
  'readiness.complete': 'The plan knows everything it must know today.',
  'readiness.missing.activity.duration.one': '{count} activity has no duration.',
  'readiness.missing.activity.duration.other': '{count} activities have no duration.',
  'readiness.missing.activity.responsible.one': '{count} activity has no responsible.',
  'readiness.missing.activity.responsible.other': '{count} activities have no responsible.',
  'readiness.missing.plan.activity.one': 'The plan has no activity yet.',
  'readiness.missing.plan.activity.other': 'The plan has no activity yet.',
  'readiness.row.activity.duration': 'no duration',
  'readiness.row.activity.responsible': 'no responsible',
  'readiness.row.plan.activity': 'the plan has no activity',
  'figure.percent': '{value} %',
  'figure.opens': 'Press it to list what it counts.',
  'figure.closes': 'Press it again to close the list.',
  'figure.nothing': 'There is nothing in it to list.',
  'figure.rows': 'What the plan does not know yet',
  'figure.broken': 'This figure does not agree with its rows, so no number is shown.',

  // ── Dashboard ─────────────────────────────────────────────────────────────
  'dashboard.lead': 'The work at a glance. Every number opens onto the rows it came from.',
  'dashboard.finish.unknown': 'Not yet known — no activity has a duration.',
  'dashboard.finish.invalidCalendar': 'Not yet known — the working calendar cannot be counted on.',
  'dashboard.finish.invalidStart': 'Not yet known — the start date is not a day.',
  'dashboard.finish.leftOut.one': 'Leaves out {count} activity with no duration.',
  'dashboard.finish.leftOut.other': 'Leaves out {count} activities with no duration.',
  'dashboard.finish.sequential':
    'Activities are placed one after another, stage by stage, from the start date.',
  'dashboard.calendar.start': 'Starts',
  'dashboard.calendar.days': 'Working days',
  'dashboard.calendar.hours': 'Hours per working day',
  'dashboard.calendar.holidays': 'Holidays',
  'dashboard.calendar.noHolidays': 'None',
  'dashboard.calendar.unreadable': 'This calendar cannot be read.',
  'dashboard.currency': 'Currency',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.lead': 'Kept on this machine, in Ridgebeam’s own database, and nowhere else.',
  'settings.appearance.title': 'Appearance',
  'settings.appearance.description': 'Light, dark, or whatever Windows is set to.',
  'settings.theme': 'Theme',
  'settings.theme.system': 'Match Windows',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.language.title': 'Language',
  'settings.language.description':
    'The words on every screen. Each language is named in itself, so you can find yours from any of them.',
  'settings.language': 'Language',
  'settings.language.system': 'Windows language',
  'settings.language.showing': 'On screen now: {language}.',
  'settings.lens.title': 'Lens',
  'settings.lens.description':
    'The same work in the words of the owner, the architect or the engineer. A lens changes the words and the arrangement, never the data.',
  'settings.lens': 'Lens',
  'settings.lens.owner': 'Owner',
  'settings.lens.architect': 'Architect',
  'settings.lens.engineer': 'Engineer',
  'settings.refused': 'The choice was not kept',
  'settings.unread': 'These are the built-in choices',

  // ── Diagnostics ───────────────────────────────────────────────────────────
  'diagnostics.lead': 'What the product claims, shown rather than asserted.',
  'diagnostics.app.title': 'This application',
  'diagnostics.app.description': 'Read from the running binary, never from a constant.',
  'diagnostics.version': 'Version',
  'diagnostics.platform': 'Platform',
  'diagnostics.dataDir': 'Application data',
  'diagnostics.database': 'Database',
  'diagnostics.schema': 'Schema version',
  'diagnostics.relocated': 'Relocated',
  'diagnostics.relocatedNote':
    'The application data was relocated by RIDGEBEAM_DATA_DIR — this is not the usual folder.',
  'diagnostics.accent': 'Accent colour',
  'diagnostics.accentSystem': 'Read from Windows',
  'diagnostics.accentDefault': 'The built-in default — Windows could not be asked',
  'diagnostics.work.title': 'The open work',
  'diagnostics.work.description': 'The folder and the database the plan is read from.',
  'diagnostics.folder': 'Folder',
  'diagnostics.journal': 'Journal mode',
  'diagnostics.synchronous': 'Synchronous',
  'diagnostics.foreignKeys': 'Foreign keys',

  // ── About ─────────────────────────────────────────────────────────────────
  'about.title': 'About Ridgebeam',
  'about.lead':
    'A works planner for the engineer, the architect and the person building once. It runs on this machine and nowhere else.',
  'about.name.title': 'The name',
  'about.name.story':
    'A ridge beam is the beam at the very top of a pitched roof, where the rafters meet: the highest piece of a house’s frame, and the last structural one to go up. In Brazil it is the cumeeira, and the day it goes up has a name of its own — the owner feeds the crew, because from that day the house has its shape. It only goes up because everything under it was planned first, and that is what Ridgebeam is for.',
  'about.build.title': 'This build',
  'about.build.description': 'Read from the running binary, never from a constant typed by hand.',
  'about.build.version': 'Version',
  'about.build.commit': 'Commit',
  'about.build.date': 'Built',
  'about.licence.title': 'Author and licence',
  'about.licence.author': 'Made by Alex Justino.',
  'about.licence.body':
    'Copyright 2026 Alex Justino. Licensed under the Apache License 2.0: you may use, modify and redistribute this software under its terms; a redistributed copy keeps the notice and says that it was modified.',
  'about.licence.trademark':
    'Ridgebeam is a trademark of Alex Justino. The licence covers the source code; it does not grant permission to use the name or the mark to endorse or promote derived products.',
  'about.licence.repository': 'Source code',
  'about.licence.copy': 'Copy the address',
  'about.licence.copied': 'Copied',
  'about.licence.copyFailed': 'The address could not be copied. Select it and copy it instead.',
  'about.data.title': 'Your data',
  'about.data.body':
    'Ridgebeam makes no network requests. There is no account, no sync, no analytics, no crash reporting and no update check. A work lives in the folder you chose, and nothing in it leaves this machine.',
  'about.data.folder': 'Ridgebeam’s own choices and its list of recent works are kept in:',
  'about.credits.title': 'Built on',
  'about.credits.description':
    'Read from the NOTICE file that ships, so this list cannot drift from it.',
  'about.credits.none':
    'NOTICE lists no third-party component yet. Each one is added as it is adopted, from the dependency manifests.',
  'about.credits.unread': 'The third-party list could not be read from NOTICE.',
} as const;

/** Every key the interface may ask for. */
export type MessageKey = keyof typeof en;

/** A dictionary: every key, as a sentence in one language. */
export type Dictionary = Readonly<Record<MessageKey, string>>;
