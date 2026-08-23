const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const initSqlJs = require("sql.js");
const XLSX = require("xlsx");
const JSZip = require("jszip");

const isDev = !app.isPackaged;
const rootDir = app.getAppPath();
// 打包后 app.getAppPath() 指向只读的应用包内部（asar 包内），不能在里面写数据库文件，
// 也会在每次升级/重装时被清空；打包环境下把数据目录改到系统的用户数据目录，开发环境保持原来放在项目里的习惯不变。
const dataDir = app.isPackaged ? path.join(app.getPath("userData"), "data") : path.join(rootDir, "data");
const attachmentsDir = path.join(dataDir, "attachments");
const exportsDir = path.join(dataDir, "exports");
const dbPath = path.join(dataDir, "classroom-workbench.sqlite");
// 这个软件要给其他老师使用，源码里不再写死任何具体班级/具体老师的私人文件夹路径；
// 家访归档、学生名单、学生简历这几类资料，统一只认"系统设置"里老师自己配置的文件夹，不配置就不自动扫描。

let SQL;
let db;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// dataFolders 里每一项现在既可能是单个字符串路径，也可能是多个路径的数组（同一类资料散落在
// 不同文件夹时可以都填上）；这个函数统一判断"是否填了至少一个有效路径"，避免空数组被当成真值。
function hasFolderValue(value) {
  if (Array.isArray(value)) return value.some((item) => item && String(item).trim());
  return Boolean(value && String(value).trim());
}

function ensureFolders() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });
}

async function openDatabase() {
  ensureFolders();
  SQL = await initSqlJs({
    locateFile: (file) => path.join(rootDir, "node_modules", "sql.js", "dist", file)
  });

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  migrate();
  seedDemoData();
  const config = getAppConfig();
  // 花名单导入是“先清空再整表重新写入”，如果误用默认文件夹会有覆盖成不同数据的风险，
  // 所以仍然严格要求 dataFolders.roster 已经在设置里配置好才会执行。
  if (config.configured && hasFolderValue(config.dataFolders?.roster)) importRosterFromFolder(config.dataFolders.roster);
  // 简历、家访归档的导入只做“新增”，不会删除或覆盖已有记录，即使设置里没填文件夹，
  // 也退回各自默认的坚果云文件夹，避免因为设置被清空而彻底停止导入。
  if (config.configured) importStudentResumes(config.dataFolders?.resume);
  relinkExternalAttachments(config); // 把历史上复制进 data/attachments 的家访、简历文件改回指向原始文件夹
  ensureCooperationGroups();
  seedSubjectData();
  normalizeTeachingSubject();
  ensureHomeworkDataForTeachingClasses();
  ensureScheduleTemplateFromScreenshots();
  if (config.configured && hasFolderValue(config.dataFolders?.homeVisit)) await importHomeVisitArchive(config.dataFolders.homeVisit);
  await backfillAttachmentText();
  resetStudentRemarksToAllergyOnce();
  recalculatePlanWeeks(getAppConfig());
  persist();
}

function persist() {
  const bytes = db.export();
  fs.writeFileSync(dbPath, Buffer.from(bytes));
}

function run(sql, params = {}) {
  db.run(sql, params);
  persist();
}

function all(sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function first(sql, params = {}) {
  return all(sql, params)[0] || null;
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeXmlText(value) {
  return clean(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

async function extractAttachmentText(filePath) {
  const extension = path.extname(filePath || "").toLowerCase();
  if (!fs.existsSync(filePath || "")) return "";
  if (extension === ".txt" || extension === ".md" || extension === ".csv") {
    return fs.readFileSync(filePath, "utf8").slice(0, 12000);
  }
  if (extension !== ".docx") return "";
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) return "";
    return decodeXmlText(
      documentXml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
    ).replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
  } catch {
    return "";
  }
}

async function createFileRecord(kind, sourcePath, originalName = path.basename(sourcePath)) {
  const target = path.join(attachmentsDir, `${Date.now()}-${originalName}`);
  fs.copyFileSync(sourcePath, target);
  const extractedText = await extractAttachmentText(target);
  db.run(
    "insert into files (kind, original_name, saved_path, extracted_text, created_at) values ($kind, $name, $saved, $text, datetime('now'))",
    { $kind: kind, $name: originalName, $saved: target, $text: extractedText }
  );
  return first("select last_insert_rowid() as id")?.id || null;
}

// 与 createFileRecord 不同：不把文件复制进 data/attachments，而是直接把外部文件夹里的
// 原始路径记为 saved_path。用于“花名单以外的资料仍留在各自的坚果云文件夹里，
// 工作台只保存映射”这种场景（如家访归档、学生简历）。原件被移动/改名/删除后，
// 这条记录会读取不到文件，需要在源文件夹修复或重新在设置里选择文件夹后触发“一键更新数据”。
async function linkFileRecord(kind, sourcePath, originalName = path.basename(sourcePath)) {
  let extractedText = "";
  try {
    extractedText = await extractAttachmentText(sourcePath);
  } catch {
    extractedText = "";
  }
  db.run(
    "insert into files (kind, original_name, saved_path, extracted_text, created_at) values ($kind, $name, $saved, $text, datetime('now'))",
    { $kind: kind, $name: originalName, $saved: sourcePath, $text: extractedText }
  );
  return first("select last_insert_rowid() as id")?.id || null;
}

async function backfillAttachmentText() {
  const rows = all("select id, saved_path from files where coalesce(extracted_text, '') = '' and lower(saved_path) like '%.docx'");
  for (const row of rows) {
    if (!row.saved_path || !fs.existsSync(row.saved_path)) continue; // 映射的外部文件暂时不可访问（如坚果云未同步完），跳过而不中断启动
    try {
      const extractedText = await extractAttachmentText(row.saved_path);
      if (!extractedText) continue;
      db.run("update files set extracted_text = $text where id = $id", { $text: extractedText, $id: row.id });
    } catch {
      // 单个文件解析失败不应影响其余文件和应用启动
    }
  }
}

// 一次性迁移：把早期版本复制进 data/attachments 的家访归档、学生简历文件，
// 改成指回坚果云里的原始文件夹（映射，而不是本地副本）。只处理 saved_path 还落在
// data/attachments 下的记录，成功改写后不会再被选中，天然幂等。
// 注意：这里只更新数据库里的路径指针，不会删除 data/attachments 里已经存在的旧副本文件，
// 那些旧文件可以在确认一切正常后手动清理。
function relinkExternalAttachments(config) {
  const staleRows = all(
    "select id, kind, original_name, saved_path from files where kind in ('student-resume', 'home-visit-archive') and saved_path like $prefix",
    { $prefix: `${attachmentsDir}%` }
  );
  if (!staleRows.length) return;

  const homeVisitDirs = hasFolderValue(config.dataFolders?.homeVisit)
    ? (Array.isArray(config.dataFolders.homeVisit) ? config.dataFolders.homeVisit : [config.dataFolders.homeVisit]).filter(Boolean)
    : [];
  const resumeDirs = hasFolderValue(config.dataFolders?.resume)
    ? (Array.isArray(config.dataFolders.resume) ? config.dataFolders.resume : [config.dataFolders.resume]).filter(Boolean)
    : [];
  // 简历文件夹配置可能填的是父目录（下面还有“5班简历”“6班简历”子文件夹），也可能直接填叶子文件夹，两种都尝试
  const expandedResumeDirs = Array.from(new Set(resumeDirs.flatMap((dir) => {
    if (!dir || !fs.existsSync(dir)) return [];
    const children = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
    return [dir, ...children];
  })));

  let relinked = 0;
  for (const row of staleRows) {
    try {
      let candidate = null;
      if (row.kind === "home-visit-archive") {
        for (const dir of homeVisitDirs) {
          const test = path.join(dir, row.original_name);
          if (fs.existsSync(test)) {
            candidate = test;
            break;
          }
        }
      } else if (row.kind === "student-resume") {
        const plainName = row.original_name.replace(/^预备[56]班-/, "");
        for (const dir of expandedResumeDirs) {
          const test = path.join(dir, plainName);
          if (fs.existsSync(test)) {
            candidate = test;
            break;
          }
        }
      }
      if (candidate) {
        db.run("update files set saved_path = $path where id = $id", { $path: candidate, $id: row.id });
        relinked += 1;
      }
    } catch (error) {
      console.error(`[附件重新映射] 跳过 ${row.kind} #${row.id}：`, error?.message || error);
    }
  }
  if (relinked > 0) {
    console.log(`[附件重新映射] 已将 ${relinked}/${staleRows.length} 条记录改回指向原始文件夹；未匹配到原文件的记录暂时仍指向本地副本。`);
  }
}

function migrate() {
  db.run(`
    create table if not exists settings (
      key text primary key,
      value text not null
    );

    create table if not exists students (
      id integer primary key autoincrement,
      student_no text,
      name text not null,
      gender text,
      class_name text,
      phone text,
      guardian text,
      guardian_relation text,
      guardian_phone text,
      father_name text,
      father_phone text,
      mother_name text,
      mother_phone text,
      ethnicity text,
      birth_date text,
      id_type text,
      id_number text,
      household_type text,
      household_address text,
      current_address text,
      elementary_school text,
      eyesight text,
      health_note text,
      sports_suitable text,
      height_cm text,
      weight_kg text,
      honors text,
      roles text,
      student_remark text not null default '',
      seating_remark text not null default '',
      is_observed integer not null default 0,
      subject_profile text default ''
    );

    create table if not exists schedule_cells (
      id integer primary key autoincrement,
      scope text not null,
      class_name text not null default '',
      day_index integer not null,
      period_index integer not null,
      time_label text not null default '',
      title text not null default '',
      teacher text not null default '',
      location text not null default '',
      tag text not null default '',
      bg_color text not null default '',
      note text not null default '',
      unique(scope, class_name, day_index, period_index)
    );

    create table if not exists seating_assignments (
      id integer primary key autoincrement,
      class_name text not null,
      seat_key text not null,
      student_id integer not null,
      updated_at text not null,
      unique(class_name, seat_key),
      unique(class_name, student_id)
    );

    create table if not exists seating_snapshots (
      id integer primary key autoincrement,
      class_name text not null,
      label text not null default '',
      seat_count integer not null default 0,
      payload text not null,
      created_at text not null
    );

    create table if not exists schedule_changes (
      id integer primary key autoincrement,
      change_date text not null,
      scope text not null,
      original_course text not null,
      new_course text not null,
      partner text not null default '',
      reason text not null default '',
      week_label text not null default '',
      change_type text not null default '换课',
      day_index integer,
      period_index integer,
      target_day_index integer,
      target_period_index integer,
      created_at text not null
    );

    create table if not exists elective_courses (
      id integer primary key autoincrement,
      class_name text not null default '预备5班',
      course_name text not null,
      course_time text not null default '',
      location text not null default '',
      note text not null default '',
      created_at text not null default CURRENT_TIMESTAMP
    );

    create table if not exists elective_enrollments (
      id integer primary key autoincrement,
      course_id integer not null,
      student_id integer not null,
      class_name text not null default '预备5班',
      updated_at text not null default CURRENT_TIMESTAMP,
      unique(course_id, student_id)
    );

    create table if not exists files (
      id integer primary key autoincrement,
      kind text not null,
      original_name text not null,
      saved_path text not null,
      extracted_text text not null default '',
      created_at text not null
    );

    create table if not exists work_logs (
      id integer primary key autoincrement,
      log_date text not null,
      type text not null,
      title text not null,
      content text not null default ''
    );

    create table if not exists class_todos (
      id integer primary key autoincrement,
      todo_date text not null,
      area text not null default '班主任',
      title text not null,
      requirement text not null default '',
      detail text not null default '',
      credential_file_id integer,
      sync_work_log integer not null default 1,
      sync_family integer not null default 0,
      student_id integer,
      family_communication_id integer,
      work_log_id integer,
      created_at text not null
    );

    create table if not exists subject_weekly_plans (
      id integer primary key autoincrement,
      week_label text not null,
      plan_date text not null,
      subject text not null default '物理',
      class_name text not null default '',
      lesson_type text not null default '新授课',
      lesson_title text not null,
      lesson_goal text not null default '',
      resources text not null default '',
      note text not null default '',
      is_done integer not null default 0,
      done_at text
    );

    create table if not exists homework_tasks (
      id integer primary key autoincrement,
      title text not null,
      subject text not null default '物理',
      class_name text not null default '',
      assign_date text not null,
      due_date text not null,
      assigned_count integer not null default 0,
      submitted_count integer not null default 0,
      checked_count integer not null default 0,
      issue_count integer not null default 0,
      note text not null default '',
      status text not null default '进行中',
      homework_type text not null default '日常作业',
      is_done integer not null default 0,
      done_at text
    );

    create table if not exists recitation_tasks (
      id integer primary key autoincrement,
      title text not null,
      subject text not null default '语文',
      class_name text not null default '',
      recitation_type text not null default '背诵',
      assign_date text not null,
      due_date text not null,
      content text not null default '',
      note text not null default '',
      status text not null default '进行中',
      is_done integer not null default 0,
      done_at text
    );

    create table if not exists student_task_status (
      id integer primary key autoincrement,
      task_kind text not null,
      task_id integer not null,
      student_id integer not null,
      class_name text not null,
      is_done integer not null default 0,
      praise integer not null default 0,
      needs_improvement integer not null default 0,
      note text not null default '',
      updated_at text not null,
      unique(task_kind, task_id, student_id)
    );

    create table if not exists assessment_tests (
      id integer primary key autoincrement,
      title text not null,
      subject text not null default '语文',
      class_name text not null default '',
      test_type text not null default '单元测评',
      test_date text not null,
      excellent_score real not null default 90,
      pass_score real not null default 60,
      paper_path text not null default '',
      note text not null default '',
      score_columns_json text not null default '[]',
      created_at text not null default CURRENT_TIMESTAMP
    );

    create table if not exists assessment_scores (
      id integer primary key autoincrement,
      test_id text not null,
      student_id integer not null,
      class_name text not null,
      score real,
      breakdown_json text not null default '{}',
      note text not null default '',
      updated_at text not null default CURRENT_TIMESTAMP,
      unique(test_id, student_id, class_name)
    );

    create table if not exists family_communications (
      id integer primary key autoincrement,
      communication_date text not null,
      student_id integer,
      student_name text not null default '',
      contact_person text not null default '',
      relation text not null default '',
      channel text not null default '',
      category text not null default '',
      title text not null,
      content text not null default '',
      follow_up_date text not null default '',
      deadline_date text not null default '',
      status text not null default '待跟进',
      attachment_file_id integer,
      created_at text not null
    );

    create table if not exists family_committee (
      id integer primary key autoincrement,
      class_name text not null default '预备5班',
      student_name text not null default '',
      relation text not null default '妈妈',
      parent_name text not null default '',
      role text not null default '',
      phone text not null default '',
      note text not null default '',
      created_at text not null default CURRENT_TIMESTAMP
    );

    create table if not exists family_activities (
      id integer primary key autoincrement,
      class_name text not null default '预备5班',
      activity_date text not null default '',
      title text not null,
      activity_type text not null default '班级活动',
      description text not null default '',
      parent_division text not null default '',
      status text not null default '筹备中',
      attachment_file_id integer,
      created_at text not null default CURRENT_TIMESTAMP
    );

    create table if not exists leave_records (
      id integer primary key autoincrement,
      leave_date text not null,
      student_id integer,
      student_name text not null default '',
      class_name text not null default '',
      period_label text not null default '全天',
      leave_type text not null default '病假',
      remark text not null default '',
      family_communication_id integer,
      created_at text not null
    );

    create table if not exists cooperation_groups (
      id integer primary key autoincrement,
      class_name text not null,
      name text not null,
      color text not null default '#1f67b1',
      goal text not null default '',
      photo_file_id integer,
      unique(class_name, name)
    );

    create table if not exists cooperation_members (
      id integer primary key autoincrement,
      group_id integer not null,
      student_id integer not null,
      role text not null default '',
      unique(group_id, student_id)
    );

    create table if not exists cooperation_records (
      id integer primary key autoincrement,
      record_date text not null,
      class_name text not null,
      group_id integer,
      student_id integer,
      type text not null,
      category text not null,
      points integer not null default 0,
      title text not null,
      note text not null default '',
      created_at text not null
    );

    create table if not exists cooperation_projects (
      id integer primary key autoincrement,
      project_date text not null,
      class_name text not null,
      group_id integer,
      project_name text not null,
      project_type text not null,
      division text not null default '',
      evaluation_note text not null default '',
      points integer not null default 0,
      evaluation_file_id integer,
      created_at text not null
    );
  `);

  ensureStudentColumns();
  ensureFileColumns();
  ensureScheduleChangeColumns();
  ensureScheduleCellColumns();
  ensureSubjectColumns();
  ensureCooperationColumns();
  ensureFamilyColumns();
  ensureWorkLogColumns();
  ensureClassTodoColumns();
  ensureAssessmentColumns();
  ensureSetupReviewSeed();
}

function ensureClassTodoColumns() {
  const existing = new Set(all("pragma table_info(class_todos)").map((row) => row.name));
  if (!existing.has("area")) db.run("alter table class_todos add column area text not null default '班主任'");
}

function ensureAssessmentColumns() {
  const testColumns = new Set(all("pragma table_info(assessment_tests)").map((row) => row.name));
  if (!testColumns.has("score_columns_json")) db.run("alter table assessment_tests add column score_columns_json text not null default '[]'");

  const scoreColumns = new Set(all("pragma table_info(assessment_scores)").map((row) => row.name));
  if (!scoreColumns.has("breakdown_json")) db.run("alter table assessment_scores add column breakdown_json text not null default '{}'");
}

function ensureSetupReviewSeed() {
  // 一次性迁移标记：老用户升级到本版本后，下次启动自动弹出首次启动引导供检查；
  // 之后由前端在关闭引导时清除 setupReviewPending。
  const seeded = getSetting("setupReviewSeeded", "");
  if (!seeded) {
    setSetting("setupReviewSeeded", "1");
    if (getAppConfig().configured) setSetting("setupReviewPending", "1");
  }
}

function ensureFamilyColumns() {
  const communicationColumns = new Set(all("pragma table_info(family_communications)").map((row) => row.name));
  if (!communicationColumns.has("deadline_date")) db.run("alter table family_communications add column deadline_date text not null default ''");

  const activityColumns = new Set(all("pragma table_info(family_activities)").map((row) => row.name));
  if (!activityColumns.has("attachment_file_id")) db.run("alter table family_activities add column attachment_file_id integer");
}

function ensureWorkLogColumns() {
  const existing = new Set(all("pragma table_info(work_logs)").map((row) => row.name));
  const columns = {
    status: "text not null default '未开始'",
    tags: "text not null default ''",
    remark: "text not null default ''",
    requirement: "text not null default ''",
    evidence_file_id: "integer",
    updated_at: "text"
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.run(`alter table work_logs add column ${name} ${type}`);
  }
}

function ensureScheduleCellColumns() {
  const existing = new Set(all("pragma table_info(schedule_cells)").map((row) => row.name));
  if (!existing.has("bg_color")) db.run("alter table schedule_cells add column bg_color text not null default ''");
  db.run("update schedule_cells set teacher = '' where teacher in ('任课教师', '任课老师')");
  if (!getSetting("scheduleDefaultColorClearedV1", false)) {
    db.run("update schedule_cells set bg_color = ''");
    setSetting("scheduleDefaultColorClearedV1", true);
  }
  if (!existing.has("class_name")) {
    // 老表没有 class_name 列，也没有按班级区分的唯一约束，这里重建整张表：
    // 加列、把 unique(scope, day_index, period_index) 换成 unique(scope, class_name, day_index, period_index)，
    // 这样以后一位老师带多个班时，每个班的课表才能分开保存，互不覆盖。
    db.run(`
      create table schedule_cells_v2 (
        id integer primary key autoincrement,
        scope text not null,
        class_name text not null default '',
        day_index integer not null,
        period_index integer not null,
        time_label text not null default '',
        title text not null default '',
        teacher text not null default '',
        location text not null default '',
        tag text not null default '',
        bg_color text not null default '',
        note text not null default '',
        unique(scope, class_name, day_index, period_index)
      );
      insert into schedule_cells_v2 (id, scope, day_index, period_index, time_label, title, teacher, location, tag, bg_color, note)
      select id, scope, day_index, period_index, time_label, title, teacher, location, tag, bg_color, note from schedule_cells;
      drop table schedule_cells;
      alter table schedule_cells_v2 rename to schedule_cells;
    `);
  }
  // 旧数据里 scope='class' 的行还没有班级名字：统一先归到"班主任班"名下（即老师目前唯一的一份班级课表）。
  const homeroomClass = getAppConfig().grade || "";
  if (homeroomClass) {
    db.run(
      "update schedule_cells set class_name = $className where scope = 'class' and class_name = ''",
      { $className: homeroomClass }
    );
  }
}

function ensureCooperationColumns() {
  const groupColumns = new Set(all("pragma table_info(cooperation_groups)").map((row) => row.name));
  if (!groupColumns.has("photo_file_id")) db.run("alter table cooperation_groups add column photo_file_id integer");
  if (!groupColumns.has("group_kind")) db.run("alter table cooperation_groups add column group_kind text not null default '常用'");

  const projectColumns = new Set(all("pragma table_info(cooperation_projects)").map((row) => row.name));
  if (!projectColumns.has("activity_detail")) db.run("alter table cooperation_projects add column activity_detail text not null default ''");
  if (!projectColumns.has("personal_scores_json")) db.run("alter table cooperation_projects add column personal_scores_json text not null default '{}'");
  if (!projectColumns.has("period_label")) db.run("alter table cooperation_projects add column period_label text not null default ''");
  if (!projectColumns.has("progress")) db.run("alter table cooperation_projects add column progress text not null default '进行中'");
}

function ensureSubjectColumns() {
  const planColumns = new Set(all("pragma table_info(subject_weekly_plans)").map((row) => row.name));
  if (!planColumns.has("lesson_type")) db.run("alter table subject_weekly_plans add column lesson_type text not null default '新授课'");

  const homeworkColumns = new Set(all("pragma table_info(homework_tasks)").map((row) => row.name));
  const columns = {
    homework_type: "text not null default '日常作业'",
    is_done: "integer not null default 0",
    done_at: "text"
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!homeworkColumns.has(name)) db.run(`alter table homework_tasks add column ${name} ${type}`);
  }

  const statusColumns = new Set(all("pragma table_info(student_task_status)").map((row) => row.name));
  if (!statusColumns.has("needs_improvement")) db.run("alter table student_task_status add column needs_improvement integer not null default 0");
}

function ensureStudentColumns() {
  const existing = new Set(all("pragma table_info(students)").map((row) => row.name));
  const columns = {
    student_no: "text",
    guardian_relation: "text",
    guardian_phone: "text",
    father_name: "text",
    father_phone: "text",
    mother_name: "text",
    mother_phone: "text",
    ethnicity: "text",
    birth_date: "text",
    id_type: "text",
    id_number: "text",
    household_type: "text",
    household_address: "text",
    current_address: "text",
    elementary_school: "text",
    eyesight: "text",
    health_note: "text",
    sports_suitable: "text",
    height_cm: "text",
    weight_kg: "text",
    honors: "text",
    roles: "text",
    student_remark: "text not null default ''",
    seating_remark: "text not null default ''",
    is_observed: "integer not null default 0"
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.run(`alter table students add column ${name} ${type}`);
  }
}

function ensureScheduleChangeColumns() {
  const existing = new Set(all("pragma table_info(schedule_changes)").map((row) => row.name));
  const columns = {
    week_label: "text not null default ''",
    change_type: "text not null default '换课'",
    day_index: "integer",
    period_index: "integer",
    target_day_index: "integer",
    target_period_index: "integer"
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.run(`alter table schedule_changes add column ${name} ${type}`);
  }
}

function ensureFileColumns() {
  const existing = new Set(all("pragma table_info(files)").map((row) => row.name));
  if (!existing.has("extracted_text")) db.run("alter table files add column extracted_text text not null default ''");
}

function setSetting(key, value) {
  db.run("insert or replace into settings (key, value) values ($key, $value)", {
    $key: key,
    $value: JSON.stringify(value)
  });
}

function getSetting(key, fallback) {
  const row = first("select value from settings where key = $key", { $key: key });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function seedDemoData() {
  const seeded = getSetting("seeded", false);
  if (seeded) return;

  db.run(`
    insert into students (student_no, name, gender, class_name, phone, guardian, subject_profile) values
      ('1', '云知夏', '女', '演示1班', '13800000001', '云妈妈', '阅读表达稳定，课堂记录认真'),
      ('2', '陆明川', '男', '演示1班', '13800000002', '陆爸爸', '朗读积极，作文结构需跟进'),
      ('3', '沈星禾', '女', '演示1班', '13800000003', '沈妈妈', '综合表现优秀，适合作为小组组织者'),
      ('1', '顾青岚', '女', '演示2班', '13800000004', '顾妈妈', '古诗积累扎实，发言可更主动'),
      ('2', '程远舟', '男', '演示2班', '13800000005', '程爸爸', '阅读速度较快，答题规范需提醒'),
      ('3', '叶安澄', '男', '演示2班', '13800000006', '叶妈妈', '基础稳，背默完成度较好');
  `);

  const timeLabels = ["08:00-08:40", "08:50-09:30", "09:50-10:30", "10:40-11:20", "13:00-13:40", "13:50-14:30", "14:45-15:25", "15:35-16:15"];
  const classCourses = [
    ["语文", "数学", "英语", "体育", "物理", "道法", "班会", "自习"],
    ["数学", "语文", "化学", "英语", "历史", "物理", "美术", "活动"],
    ["英语", "物理", "语文", "数学", "体育", "化学", "自习", "社团"],
    ["语文", "英语", "数学", "历史", "物理", "劳动", "班会", "自习"],
    ["数学", "语文", "英语", "物理实验", "化学", "体育", "安全教育", "整理"]
  ];
  const personalCourses = [
    ["", "演示1班语文", "", "演示2班语文", "备课", "", "答疑", ""],
    ["演示1班语文", "", "作文批改", "", "演示2班语文", "", "", ""],
    ["", "演示1班阅读", "", "演示2班语文", "", "教研", "", ""],
    ["演示2班语文", "", "", "演示1班语文", "", "", "班会", ""],
    ["", "演示1班语文", "", "监考", "演示2班答疑", "", "", ""]
  ];

  const insertCell = db.prepare(`
    insert into schedule_cells (scope, class_name, day_index, period_index, time_label, title, teacher, location, tag, note)
    values ($scope, $className, $day, $period, $time, $title, $teacher, $location, $tag, $note)
  `);

  for (const scope of ["class", "personal"]) {
    const grid = scope === "class" ? classCourses : personalCourses;
    for (let day = 0; day < 5; day += 1) {
      for (let period = 0; period < timeLabels.length; period += 1) {
        const title = grid[day][period] || "";
        insertCell.run({
          $scope: scope,
          $className: scope === "class" ? "演示1班" : "",
          $day: day,
          $period: period,
          $time: timeLabels[period],
          $title: title,
          $teacher: "",
          $location: title.includes("实验") ? "实验室" : "教室",
          $tag: title.includes("实验") ? "实验课" : title.includes("班会") || title.includes("活动") ? "班级活动" : "",
          $note: ""
        });
      }
    }
  }
  insertCell.free();

  db.run(`
    insert into schedule_changes (change_date, scope, original_course, new_course, partner, reason, created_at) values
      ('2026-08-21', 'class', '周五第4节 物理实验', '周五第5节 物理实验', '化学组', '实验室预约调整', datetime('now')),
      ('2026-08-24', 'personal', '九1物理答疑', '九1监考', '教务处', '期初摸底监考安排', datetime('now'));
  `);

  db.run(`
    insert into work_logs (log_date, type, title, content) values
      ('2026-08-19', '德育工作', '入校考勤完成', '自动同步至出勤统计'),
      ('2026-08-19', '班级管理', '座位方案保存', '参考学科成绩与综合表现'),
      ('2026-08-19', '安全教育', '安全教育留痕', '可导出学期台账');
  `);

  setSetting("scheduleMeta", {
    className: "演示1班",
    term: "2026 学年第一学期",
    weekLabel: "本周第 1 周"
  });
  setSetting("seeded", true);
}

function seedSubjectData() {
  const seeded = getSetting("subjectSeeded", false);
  if (seeded) return;

  const meta = getSetting("scheduleMeta", {});
  const className = meta.className || "预备5班";
  const studentCount = first("select count(*) as n from students")?.n || 44;

  db.run(`
    insert into subject_weekly_plans (week_label, plan_date, subject, class_name, lesson_title, lesson_goal, resources, note, is_done, done_at) values
      ('第1周', '2026-08-20', '语文', '${className}', '语文学习方法与课堂规范', '建立课堂规范，了解阅读批注与作业要求', '学科导学单、阅读记录单', '开学第一课，关注课堂习惯', 1, datetime('now')),
      ('第1周', '2026-08-21', '语文', '${className}', '现代文阅读：圈画与概括', '能圈画关键信息，完成一句话概括', '阅读练习、批注示例', '安排一次小组交流', 0, null),
      ('第2周', '2026-08-25', '语文', '${className}', '古诗文诵读与积累', '能准确朗读并完成重点字词积累', '课件、背默单', '与背默管理联动', 0, null);

    insert into homework_tasks (title, subject, class_name, assign_date, due_date, assigned_count, submitted_count, checked_count, issue_count, note, status) values
      ('语文导学单：学习准备', '语文', '${className}', '2026-08-20', '2026-08-21', ${studentCount}, 5, 3, 1, '重点关注批注格式', '进行中'),
      ('阅读练习：信息提取与概括', '语文', '${className}', '2026-08-21', '2026-08-24', ${studentCount}, 0, 0, 0, '下节课前收齐', '未收齐');
  `);

  setSetting("subjectSeeded", true);
}

function ensureHomeworkDataForTeachingClasses() {
  const config = getAppConfig();
  const subject = config.subject || "语文";
  const classes = config.teachingClasses?.length ? config.teachingClasses : ["演示1班", "演示2班"];
  for (const className of classes) {
    const existing = first("select count(*) as n from homework_tasks where class_name = $className", { $className: className })?.n || 0;
    if (existing > 0) continue;
    const studentCount = first("select count(*) as n from students where class_name = $className", { $className: className })?.n || 0;
    db.run(
      `insert into homework_tasks (title, subject, class_name, assign_date, due_date, assigned_count, submitted_count, checked_count, issue_count, note, status) values
        ($title1, $subject, $className, '2026-08-20', '2026-08-21', $count, 0, 0, 0, '可按班级调整收交与问题人数', '进行中'),
        ($title2, $subject, $className, '2026-08-22', '2026-08-25', $count, 0, 0, 0, '用于记录阅读、订正、作文等作业问题', '未收齐')`,
      {
        $title1: `${subject}导学单：学习准备`,
        $title2: `${subject}阅读练习：信息提取与概括`,
        $subject: subject,
        $className: className,
        $count: studentCount
      }
    );
  }
}

function defaultAppConfig() {
  return {
    configured: false,
    grade: "预备5班",
    termPart: "上学期",
    subject: "语文",
    teachingWeeks: 20,
    startDate: "2026-09-01",
    teacherName: "",
    teacherPhone: "",
    theme: "blue",
    dataMode: "demo",
    teachingClasses: ["演示1班", "演示2班"],
    dataFolders: {}
  };
}

function getAppConfig() {
  return { ...defaultAppConfig(), ...getSetting("appConfig", {}) };
}

// 导出文件默认存放位置：老师在设置里填过就用老师填的（多个文件夹时取第一个）；
// 没填过就默认桌面；连桌面都拿不到（极少见）才退回项目自带的 data/exports 文件夹。
function resolveExportsDir() {
  const configured = getAppConfig().dataFolders?.exports;
  const first = Array.isArray(configured) ? configured.find(Boolean) : configured;
  if (first && String(first).trim()) return String(first).trim();
  try {
    const desktop = app.getPath("desktop");
    if (desktop) return desktop;
  } catch {
    // 极少数环境下拿不到桌面路径，退回项目自带的导出文件夹
  }
  return exportsDir;
}

function getWeekLabel(config) {
  return getWeekLabelForDate(config, new Date());
}

function getWeekLabelForDate(config, dateValue) {
  const start = new Date(`${config.startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "第1周";
  const target = dateValue instanceof Date ? dateValue : new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(target.getTime())) return "第1周";
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((target.setHours(0, 0, 0, 0) - start.getTime()) / dayMs);
  const rawWeek = Math.floor(Math.max(0, diffDays) / 7) + 1;
  const cappedWeek = Math.min(Number(config.teachingWeeks || 20), rawWeek);
  return `第${cappedWeek}周`;
}

function getWeekdayLabel(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function recalculatePlanWeeks(config) {
  const plans = all("select id, plan_date from subject_weekly_plans");
  for (const plan of plans) {
    db.run("update subject_weekly_plans set week_label = $week where id = $id", {
      $week: getWeekLabelForDate(config, plan.plan_date),
      $id: plan.id
    });
  }
}

function normalizeTeachingSubject() {
  if (getSetting("teachingSubjectNormalizedV1", false)) return;
  db.run(`
    update schedule_cells set title = replace(title, '物理', '语文') where title like '%物理%';
    update schedule_changes set original_course = replace(original_course, '物理', '语文'), new_course = replace(new_course, '物理', '语文') where original_course like '%物理%' or new_course like '%物理%';
    update subject_weekly_plans set
      subject = '语文',
      lesson_title = case
        when lesson_title = '科学方法与物理学习导入' then '初中语文学习方法与课堂规范'
        when lesson_title = '长度与时间的测量' then '现代文阅读：概括与信息提取'
        when lesson_title = '运动的描述' then '古诗文诵读与积累方法'
        else replace(lesson_title, '物理', '语文')
      end,
      lesson_goal = case
        when lesson_goal like '%实验%' then '建立语文课堂规范，明确阅读、积累、表达的学习要求'
        else lesson_goal
      end,
      resources = replace(resources, '实验', '阅读')
    where subject = '物理' or lesson_title like '%物理%';
    update homework_tasks set
      subject = '语文',
      title = case
        when title = '物理导学单：测量工具认识' then '语文导学单：初中语文学习准备'
        when title = '课堂练习：长度与时间测量' then '阅读练习：信息提取与概括'
        else replace(title, '物理', '语文')
      end,
      note = replace(note, '单位换算和估读表达', '阅读圈画和概括表达')
    where subject = '物理' or title like '%物理%';
  `);
  setSetting("teachingSubjectNormalizedV1", true);
}

function syncPersonalScheduleSubject(nextSubject) {
  const previous = getAppConfig().subject || "语文";
  if (!nextSubject || previous === nextSubject) return;
  db.run(
    "update schedule_cells set title = replace(title, $previous, $next) where scope = 'personal' and title like $pattern",
    { $previous: previous, $next: nextSubject, $pattern: `%${previous}%` }
  );
  db.run(
    "update schedule_changes set original_course = replace(original_course, $previous, $next), new_course = replace(new_course, $previous, $next) where scope = 'personal'",
    { $previous: previous, $next: nextSubject }
  );
}

function ensureScheduleTemplateFromScreenshots() {
  if (getSetting("scheduleTemplateV2", false)) return;
  const config = getAppConfig();
  const subject = config.subject || "语文";
  const timeLabels = [
    "7:30-8:00",
    "8:25-9:05",
    "9:15-9:55",
    "10:05-10:50",
    "11:00-11:40",
    "12:20-12:50",
    "12:55-13:40",
    "13:50-14:35",
    "15:05-15:45",
    "15:55-16:35",
    "16:45-17:20"
  ];
  const classCourses = [
    ["语文", "语文", "语文", "语文", "语文"],
    ["数学", "数学", "英语", "语文", "数学"],
    ["体育与健康", "化学", "英语", "语文", "英语"],
    ["英语", "体活", "数学", "体育与健康", "语文"],
    ["物理", "劳动技术（创新）", "化学", "道德与法治", "物理"],
    ["数学", "英语", "数学", "英语", "语文"],
    ["美术", "历史", "体育与健康", "历史", "生命科学"],
    ["道德与法治", "生命科学", "物理", "听说拓展", "少先队活动课"],
    ["语文", "语文", "音乐", "劳动技术（实践）", ""],
    ["体活", "英语综合", "语文综合", "数学综合", ""],
    ["", "", "", "", ""]
  ];
  const subjectCourses = [
    ["6班", "6班", "6班", "6班", "6班"],
    ["", "", "5班", "6班", ""],
    ["5班", "", "", "6班", ""],
    ["5班", "", "", "5班", "6班"],
    ["", "", "", "", ""],
    ["", "5班", "", "", "6班"],
    ["", "", "", "", "5班"],
    ["", "", "", "", "少先队活动课"],
    ["6班", "6班", "", "", "6班"],
    ["", "5班", "6班", "", ""],
    ["", "6班", "", "", ""]
  ];

  const homeroomClass = config.grade || "5班";
  db.run("delete from schedule_cells where scope in ('class', 'personal')");
  const insertCell = db.prepare(`
    insert into schedule_cells (scope, class_name, day_index, period_index, time_label, title, teacher, location, tag, note)
    values ($scope, $className, $day, $period, $time, $title, $teacher, $location, $tag, $note)
  `);

  for (const [scope, grid] of [["class", classCourses], ["personal", subjectCourses]]) {
    for (let period = 0; period < timeLabels.length; period += 1) {
      for (let day = 0; day < 5; day += 1) {
        const rawTitle = grid[period][day] || "";
        const title = scope === "personal" && /^\d班$/.test(rawTitle) ? `${rawTitle}${subject}` : rawTitle;
        insertCell.run({
          $scope: scope,
          $className: scope === "class" ? homeroomClass : "",
          $day: day,
          $period: period,
          $time: timeLabels[period],
          $title: title,
          $teacher: "",
          $location: title ? "教室" : "",
          $tag: title.includes("活动") || title.includes("晨间") ? "活动" : title.includes(subject) ? "授课" : "",
          $note: ""
        });
      }
    }
  }
  insertCell.free();
  setSetting("scheduleTemplateV2", true);
}

function cleanScheduleTitle(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/老师姓名|任课教师|任课老师/g, "")
    .trim();
}

function importScheduleWorkbook(sourcePath, scope, className = "") {
  const subject = getAppConfig().subject || "语文";
  const workbook = XLSX.readFile(sourcePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return;
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
  const dayHeaders = ["一", "二", "三", "四", "五"];
  const resolvedClassName = scope === "class" ? (className || getAppConfig().grade || "") : "";
  const insertCell = db.prepare(`
    insert into schedule_cells (scope, class_name, day_index, period_index, time_label, title, teacher, location, tag, bg_color, note)
    values ($scope, $className, $day, $period, $time, $title, '', '', $tag, '', '')
    on conflict(scope, class_name, day_index, period_index) do update set
      time_label = excluded.time_label,
      title = excluded.title,
      teacher = case when schedule_cells.title = excluded.title then schedule_cells.teacher else '' end,
      tag = excluded.tag,
      bg_color = ''
  `);

  for (const row of matrix) {
    const cells = row.map(cleanScheduleTitle);
    const periodRaw = cells[1] || cells[0] || "";
    const numericPeriod = Number(periodRaw);
    const period = ["早看护", "晨间"].includes(periodRaw) ? 0
      : ["午看护", "午间"].includes(periodRaw) ? 5
      : ["课后服务", "课后"].includes(periodRaw) ? 10
      : numericPeriod >= 1 && numericPeriod <= 4 ? numericPeriod
      : numericPeriod >= 5 && numericPeriod <= 8 ? numericPeriod + 1
      : null;
    if (period == null || period > 10) continue;
    const timeLabel = /\d{1,2}:\d{2}/.test(cells[0] || "") ? cells[0] : "";

    const headerIndex = cells.findIndex((cell) => dayHeaders.some((day) => cell.includes(`星期${day}`) || cell.includes(`周${day}`)));
    const startIndex = headerIndex >= 0 ? headerIndex : 2;
    for (let day = 0; day < 5; day += 1) {
      const rawTitle = cleanScheduleTitle(cells[startIndex + day]);
      const title = scope === "personal" && /^\d班$/.test(rawTitle) ? `${rawTitle}${subject}` : rawTitle;
      insertCell.run({
        $scope: scope,
        $className: resolvedClassName,
        $day: day,
        $period: period,
        $time: timeLabel,
        $title: title,
        $tag: title ? "授课" : ""
      });
    }
  }
  insertCell.free();
}

function listDataFiles(sourceDirs = "", extensions = []) {
  const allowed = new Set(extensions.map((item) => item.toLowerCase()));
  const inputs = (Array.isArray(sourceDirs) ? sourceDirs : [sourceDirs]).filter(Boolean);
  const files = [];
  for (const sourcePath of inputs) {
    if (!fs.existsSync(sourcePath)) continue;
    const stat = fs.statSync(sourcePath);
    if (stat.isFile()) {
      if (!allowed.size || allowed.has(path.extname(sourcePath).toLowerCase())) files.push(sourcePath);
      continue;
    }
    for (const name of fs.readdirSync(sourcePath)) {
      const fullPath = path.join(sourcePath, name);
      if (fs.statSync(fullPath).isFile() && (!allowed.size || allowed.has(path.extname(name).toLowerCase()))) {
        files.push(fullPath);
      }
    }
  }
  return Array.from(new Set(files));
}

function importSchedulesFromFolder(sourceDirs = "", options = {}) {
  const files = listDataFiles(sourceDirs, [".xlsx", ".xls", ".csv"]);
  if (!files.length) return;
  const signature = files.map((sourcePath) => {
    const stat = fs.statSync(sourcePath);
    return `${sourcePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  }).join("|");
  if (!options.force && getSetting("scheduleFolderSignature", "") === signature) return;

  const config = getAppConfig();
  for (const sourcePath of files) {
    const name = path.basename(sourcePath);
    const scope = /任教|个人|学科/.test(name) ? "personal" : "class";
    const className = scope === "class"
      ? (/6班/.test(name) ? "预备6班" : /5班/.test(name) ? "预备5班" : config.grade || "")
      : "";
    try {
      importScheduleWorkbook(sourcePath, scope, className);
    } catch (error) {
      console.error(`[课表导入] 跳过文件 ${name}：`, error?.message || error);
    }
  }
  setSetting("scheduleFolderSignature", signature);
}

async function importHomeVisitArchive(sourceDirs = "", options = {}) {
  // 支持传入单个文件夹路径，也支持传入多个文件夹的数组（同一类资料散落在不同文件夹时都能导入）
  const sources = (Array.isArray(sourceDirs) ? sourceDirs : [sourceDirs]).filter((source) => source && fs.existsSync(source));
  if (!sources.length) return;

  const allFiles = sources.flatMap((source) => {
    const stat = fs.statSync(source);
    if (stat.isFile()) {
      return source.endsWith(".docx") ? [{ dir: path.dirname(source), name: path.basename(source) }] : [];
    }
    return fs.readdirSync(source).filter((name) => name.endsWith(".docx")).map((name) => ({ dir: source, name }));
  });
  const signature = allFiles
    .map(({ dir, name }) => {
      const stat = fs.statSync(path.join(dir, name));
      return `${dir}/${name}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    })
    .join("|");
  if (!signature || (!options.force && getSetting("homeVisitArchiveSignature", "") === signature)) return;

  for (const { dir, name } of allFiles) {
    try {
      const match = name.match(/^(\d+)\s+(.+?)\s+家访\.docx$/);
      const studentNo = match?.[1] || "";
      const studentName = match?.[2] || name.replace(/\.docx$/, "");
      const existing = first(
        "select id from family_communications where category = '家访' and title = $title and student_name = $name",
        { $title: "新生家访归档", $name: studentName }
      );
      if (existing) continue;

      const sourcePath = path.join(dir, name);
      // 不复制进 data/attachments：家访归档留在原来的坚果云文件夹里，这里只存一份路径映射
      const fileId = await linkFileRecord("home-visit-archive", sourcePath, name);
      const student = first("select id, guardian, guardian_relation from students where name = $name or student_no = $studentNo", {
        $name: studentName,
        $studentNo: studentNo
      });
      db.run(
        `insert into family_communications (
          communication_date, student_id, student_name, contact_person, relation, channel, category,
          title, content, follow_up_date, status, attachment_file_id, created_at
        ) values (
          '2026-08-01', $studentId, $studentName, $contact, $relation, '家访', '家访',
          '新生家访归档', $content, '', '已完成', $fileId, datetime('now')
        )`,
        {
          $studentId: student?.id || null,
          $studentName: studentName,
          $contact: student?.guardian || "",
          $relation: student?.guardian_relation || "",
          $content: `已接入新生家访归档文件：${name}`,
          $fileId: fileId
        }
      );
    } catch (error) {
      console.error(`[家访归档导入] 跳过文件 ${name}：`, error?.message || error);
    }
  }
  setSetting("homeVisitArchiveSignature", signature);
}

function importStudentResumes(sourceDir = "", options = {}) {
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".pdf"]);
  // 支持传入单个文件夹路径，也支持传入多个文件夹的数组；不传/没配置就不导入，不再有写死的默认文件夹
  const dirs = Array.isArray(sourceDir) && sourceDir.length ? sourceDir.filter(Boolean) : sourceDir ? [sourceDir] : [];
  const files = dirs.flatMap((dir) => {
    if (!fs.existsSync(dir)) return [];
    const sourceStat = fs.statSync(dir);
    if (sourceStat.isFile()) {
      return allowedExtensions.has(path.extname(dir).toLowerCase())
        ? [{ dir: path.dirname(dir), name: path.basename(dir), className: dir.includes("6班") ? "预备6班" : dir.includes("5班") ? "预备5班" : "" }]
        : [];
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        const child = path.join(dir, entry.name);
        return fs.readdirSync(child)
          .filter((name) => allowedExtensions.has(path.extname(name).toLowerCase()))
          .map((name) => ({ dir: child, name, className: entry.name.includes("6班") ? "预备6班" : entry.name.includes("5班") ? "预备5班" : "" }));
      }
      return allowedExtensions.has(path.extname(entry.name).toLowerCase())
        ? [{ dir, name: entry.name, className: dir.includes("6班") ? "预备6班" : dir.includes("5班") ? "预备5班" : "" }]
        : [];
    });
  });
  const signature = files.map(({ dir, name }) => {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    return `${path.basename(dir)}/${name}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  }).join("|");
  if (!signature || (!options.force && getSetting("studentResumeSignature", "") === signature)) return;

  const students = all("select id, name, class_name from students");
  for (const { dir, name, className } of files) {
    try {
      const matchedStudent = students.find((student) => (!className || student.class_name === className) && name.includes(student.name));
      if (!matchedStudent) continue;
      const existing = first(
        "select id from files where kind = 'student-resume' and original_name = $name",
        { $name: `${className}-${name}` }
      );
      if (existing) continue;

      // 不复制进 data/attachments：简历原图留在原来的坚果云文件夹里，这里只存一份路径映射
      const sourcePath = path.join(dir, name);
      db.run(
        "insert into files (kind, original_name, saved_path, created_at) values ('student-resume', $name, $saved, datetime('now'))",
        { $name: `${className}-${name}`, $saved: sourcePath }
      );
    } catch (error) {
      console.error(`[学生简历导入] 跳过文件 ${name}：`, error?.message || error);
    }
  }
  setSetting("studentResumeSignature", signature);
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function formatClassName(value, fallback = "预备5班") {
  const text = clean(value);
  if (!text) return fallback;
  return /^\d+$/.test(text) ? `预备${text}班` : text;
}

function pick(row, headers, keyword) {
  const index = headers.findIndex((header) => clean(header).includes(keyword));
  return index >= 0 ? clean(row[index]) : "";
}

function importRosterFromFolder(sourceDirs = "", options = {}) {
  // 支持传入单个文件夹路径，也支持传入多个文件夹的数组
  const sources = (Array.isArray(sourceDirs) ? sourceDirs : [sourceDirs]).filter((source) => source && fs.existsSync(source));
  if (!sources.length) return;
  const candidates = Array.from(new Set(sources.flatMap((sourceDir) => {
    const sourceStat = fs.statSync(sourceDir);
    if (sourceStat.isFile()) {
      return [".xlsx", ".xls", ".csv"].includes(path.extname(sourceDir).toLowerCase()) ? [sourceDir] : [];
    }
    const knownCandidates = [
      path.join(sourceDir, "班级基础信息 2026级  (5).xlsx"),
      path.join(sourceDir, "班级基础信息 2026级  (6).xlsx"),
      path.join(sourceDir, "预备5班学生名单.xlsx"),
      path.join(sourceDir, "预备6班学生名单.xlsx")
    ].filter((file) => fs.existsSync(file));
    const folderCandidates = fs.readdirSync(sourceDir)
      .filter((name) => [".xlsx", ".xls", ".csv"].includes(path.extname(name).toLowerCase()))
      .map((name) => path.join(sourceDir, name));
    return [...knownCandidates, ...folderCandidates];
  })));

  if (candidates.length === 0) return;

  const signature = candidates.map((sourcePath) => {
    const stat = fs.statSync(sourcePath);
    return `${path.basename(sourcePath)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  }).join("|");
  if (!options.force && getSetting("rosterImportSignatureV2", "") === signature) return;

  const seen = new Set();
  const imported = [];
  for (const sourcePath of candidates) {
    const workbook = XLSX.readFile(sourcePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const className = path.basename(sourcePath).includes("(6)") || path.basename(sourcePath).includes("6班") ? "预备6班" : "预备5班";
    const parsed = sourcePath.includes("基础信息")
      ? parseDetailedRoster(rows, className)
      : parseSimpleRoster(rows, className);
    for (const student of parsed) {
      const key = `${student.$class_name}-${student.$student_no}-${student.$name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imported.push(student);
    }
  }

  if (imported.length === 0) return;

  db.run("delete from students");
  const insert = db.prepare(`
    insert into students (
      student_no, name, gender, class_name, phone, guardian, guardian_relation, guardian_phone,
      father_name, father_phone, mother_name, mother_phone, ethnicity, birth_date, id_type, id_number,
      household_type, household_address, current_address, elementary_school, eyesight, health_note,
      sports_suitable, height_cm, weight_kg, honors, roles, student_remark, subject_profile
    ) values (
      $student_no, $name, $gender, $class_name, $phone, $guardian, $guardian_relation, $guardian_phone,
      $father_name, $father_phone, $mother_name, $mother_phone, $ethnicity, $birth_date, $id_type, $id_number,
      $household_type, $household_address, $current_address, $elementary_school, $eyesight, $health_note,
      $sports_suitable, $height_cm, $weight_kg, $honors, $roles, $student_remark, $subject_profile
    )
  `);

  for (const student of imported) insert.run(student);
  insert.free();

  setSetting("scheduleMeta", {
    ...getSetting("scheduleMeta", {}),
    className: "预备5班"
  });
  setSetting("rosterImportSignatureV2", signature);
  setSetting("rosterImportInfo", {
    file: candidates.map((file) => path.basename(file)).join("、"),
    count: imported.length,
    importedAt: new Date().toISOString()
  });
}

function syncStudentRemarksFromFamily() {
  const students = all("select id, name from students");
  for (const student of students) {
    const records = all(
      `select communication_date, category, title, status
       from family_communications
       where student_id = $id or student_name = $name
       order by communication_date desc, id desc
       limit 6`,
      { $id: student.id, $name: student.name }
    );
    const remark = records.map((record) => [
      record.communication_date,
      record.category,
      record.title,
      record.status && record.status !== "已完成" ? record.status : ""
    ].filter(Boolean).join(" · ")).join("\n");
    db.run("update students set student_remark = $remark where id = $id", {
      $remark: remark,
      $id: student.id
    });
  }
}

function allergyRemarkFromStudent(student) {
  // 备注只放过敏信息：不再拼接“运动是否适合”字段，并把含“适合”字样的分句也过滤掉
  const text = String(student.health_note || "").trim();
  if (!text.includes("过敏")) return "";
  return text
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter((part) => part && !part.includes("适合"))
    .join("；");
}

function resetStudentRemarksToAllergyOnce() {
  if (getSetting("studentRemarkAllergyOnlyV2", false)) return;
  const students = all("select id, health_note, sports_suitable from students");
  for (const student of students) {
    db.run("update students set student_remark = $remark where id = $id", {
      $remark: allergyRemarkFromStudent(student),
      $id: student.id
    });
  }
  setSetting("studentRemarkAllergyOnlyV2", true);
}

function ensureCooperationGroups() {
  const classes = all("select distinct class_name from students where coalesce(class_name, '') != '' order by class_name")
    .map((row) => row.class_name);
  const colors = ["#1f67b1", "#4fa66a", "#d99b33", "#d96058", "#5b75c8", "#6a9fb5"];
  for (const className of classes) {
    const existing = first("select count(*) as n from cooperation_groups where class_name = $className", { $className: className })?.n || 0;
    if (existing === 0) {
      for (let index = 0; index < 6; index += 1) {
        db.run(
          "insert into cooperation_groups (class_name, name, color, goal) values ($className, $name, $color, $goal)",
          {
            $className: className,
            $name: `第${index + 1}小组`,
            $color: colors[index],
            $goal: "合作学习、互助成长"
          }
        );
      }
    }

    const groups = all("select * from cooperation_groups where class_name = $className order by id", { $className: className });
    const students = all("select id, student_no from students where class_name = $className order by cast(student_no as integer), student_no, id", { $className: className });
    for (let index = 0; index < students.length; index += 1) {
      const student = students[index];
      const already = first("select id from cooperation_members where student_id = $id", { $id: student.id });
      if (already || groups.length === 0) continue;
      const group = groups[index % groups.length];
      db.run(
        "insert or ignore into cooperation_members (group_id, student_id, role) values ($groupId, $studentId, '')",
        { $groupId: group.id, $studentId: student.id }
      );
    }
  }
}

function getCooperationData() {
  const groups = all(`
    select g.*, f.saved_path as photo_path, f.original_name as photo_name,
      coalesce((select sum(points) from cooperation_records where group_id = g.id), 0)
        + coalesce((select sum(points) from cooperation_projects where group_id = g.id), 0) as points,
      coalesce((select count(*) from cooperation_records where group_id = g.id and type = 'achievement'), 0) as achievement_count,
      coalesce((select count(*) from cooperation_records where group_id = g.id and type = 'reminder'), 0) as reminder_count,
      coalesce((select count(*) from cooperation_projects where group_id = g.id), 0) as project_count
    from cooperation_groups g
    left join files f on f.id = g.photo_file_id
    order by g.class_name, points desc, g.id
  `);
  const members = all(`
    select m.*, s.name, s.student_no, s.class_name,
      coalesce(sum(r.points), 0) as points,
      sum(case when r.type = 'achievement' then 1 else 0 end) as achievement_count,
      sum(case when r.type = 'reminder' then 1 else 0 end) as reminder_count
    from cooperation_members m
    join students s on s.id = m.student_id
    left join cooperation_records r on r.student_id = s.id
    group by m.id
    order by s.class_name, m.group_id, cast(s.student_no as integer), s.student_no
  `);
  const records = all(`
    select r.*, g.name as group_name, s.name as student_name, s.student_no
    from cooperation_records r
    left join cooperation_groups g on g.id = r.group_id
    left join students s on s.id = r.student_id
    order by r.record_date desc, r.id desc
    limit 80
  `);
  const projects = all(`
    select p.*, g.name as group_name, f.original_name as evaluation_file_name, f.saved_path as evaluation_file_path
    from cooperation_projects p
    left join cooperation_groups g on g.id = p.group_id
    left join files f on f.id = p.evaluation_file_id
    order by p.project_date desc, p.id desc
  `);
  return {
    groups,
    members,
    records,
    projects,
    stats: {
      groupCount: groups.length,
      recordCount: records.length,
      achievementCount: records.filter((record) => record.type === "achievement").length,
      reminderCount: records.filter((record) => record.type === "reminder").length
    }
  };
}

function parseDetailedRoster(rows, fallbackClassName = "预备5班") {
  if (rows.length < 2) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1)
    .filter((row) => clean(row[1]) && clean(row[2]))
    .map((row) => {
      const honors = [
        pick(row, headers, "区级及以上综合荣誉"),
        pick(row, headers, "具体荣誉名称及年份"),
        pick(row, headers, "校级"),
        pick(row, headers, "校级综合荣誉"),
        pick(row, headers, "音乐/舞蹈/美术类"),
        pick(row, headers, "体育类"),
        pick(row, headers, "科技类")
      ].filter(Boolean).join("；");
      const healthNote = clean(row[53]);
      const sportsSuitable = clean(row[54]);
      const allergyRemark = [healthNote, sportsSuitable].filter(Boolean).join("；").includes("过敏")
        ? [healthNote, sportsSuitable].filter(Boolean).join("；")
        : "";

      return {
        $student_no: clean(row[2]),
        $name: clean(row[1]),
        $gender: clean(row[3]),
        $class_name: formatClassName(row[0], fallbackClassName),
        $phone: pick(row, headers, "紧急情况首选联系人电话") || clean(row[30]) || clean(row[18]) || clean(row[21]),
        $guardian: clean(row[28]),
        $guardian_relation: clean(row[29]),
        $guardian_phone: clean(row[30]),
        $father_name: clean(row[16]),
        $father_phone: clean(row[18]),
        $mother_name: clean(row[19]),
        $mother_phone: clean(row[21]),
        $ethnicity: clean(row[4]),
        $birth_date: clean(row[5]),
        $id_type: clean(row[9]),
        $id_number: clean(row[10]),
        $household_type: clean(row[11]),
        $household_address: clean(row[13]),
        $current_address: clean(row[15]),
        $elementary_school: clean(row[25]),
        $eyesight: [clean(row[31]), clean(row[32]), clean(row[33]), clean(row[34])].filter(Boolean).join("；"),
        $health_note: healthNote,
        $sports_suitable: sportsSuitable,
        $height_cm: clean(row[51]),
        $weight_kg: clean(row[52]),
        $honors: honors,
        $roles: "",
        $student_remark: allergyRemark,
        $subject_profile: ""
      };
    });
}

function parseSimpleRoster(rows, fallbackClassName = "预备5班") {
  return rows.slice(2)
    .filter((row) => clean(row[0]) && clean(row[1]))
    .map((row) => ({
      $student_no: clean(row[0]),
      $name: clean(row[1]),
      $gender: "",
      $class_name: fallbackClassName,
      $phone: "",
      $guardian: "",
      $guardian_relation: "",
      $guardian_phone: "",
      $father_name: "",
      $father_phone: "",
      $mother_name: "",
      $mother_phone: "",
      $ethnicity: "",
      $birth_date: "",
      $id_type: "",
      $id_number: "",
      $household_type: "",
      $household_address: "",
      $current_address: "",
      $elementary_school: "",
      $eyesight: "",
      $health_note: "",
      $sports_suitable: "",
      $height_cm: "",
      $weight_kg: "",
      $honors: "",
      $roles: "",
      $student_remark: "",
      $subject_profile: ""
    }));
}

function getSchedule(scope) {
  return all(
    "select * from schedule_cells where scope = $scope order by period_index, day_index",
    { $scope: scope }
  );
}

function getBootstrapData() {
  const appConfig = getAppConfig();
  const savedScheduleMeta = getSetting("scheduleMeta", {});
  const scheduleMeta = {
    ...savedScheduleMeta,
    className: appConfig.grade || savedScheduleMeta.className || "预备5班",
    term: `2026 学年${appConfig.termPart || "上学期"}`,
    weekLabel: getWeekLabel(appConfig)
  };
  const students = all("select * from students order by id");
  const classSchedule = getSchedule("class");
  const personalSchedule = getSchedule("personal");
  const changes = all("select * from schedule_changes order by change_date desc, id desc");
  const files = all("select * from files order by id desc limit 8");
  const logs = all(`
    select wl.*, f.original_name as evidence_name, f.saved_path as evidence_path
    from work_logs wl
    left join files f on f.id = wl.evidence_file_id
    order by wl.log_date desc, wl.id desc
    limit 500
  `);
  const classTodos = all(`
    select ct.*, s.name as student_name, f.original_name as credential_name, f.saved_path as credential_path
    from class_todos ct
    left join students s on s.id = ct.student_id
    left join files f on f.id = ct.credential_file_id
    order by ct.todo_date desc, ct.id desc
    limit 500
  `);
  const rosterImportInfo = getSetting("rosterImportInfo", null);
  const subjectPlans = all("select * from subject_weekly_plans order by plan_date asc, id asc");
  const homeworkTasks = all("select * from homework_tasks order by due_date asc, id asc");
  const recitationTasks = all("select * from recitation_tasks order by due_date asc, id asc");
  const assessmentTests = all("select * from assessment_tests order by test_date desc, id desc").map((row) => {
    let score_columns = [];
    try { score_columns = JSON.parse(row.score_columns_json || "[]"); } catch { score_columns = []; }
    return { ...row, score_columns };
  });
  const assessmentScores = all("select * from assessment_scores order by class_name, student_id").map((row) => {
    let breakdown = {};
    try { breakdown = JSON.parse(row.breakdown_json || "{}"); } catch { breakdown = {}; }
    return { ...row, breakdown };
  });
  const electiveCourses = all("select * from elective_courses order by id asc");
  const electiveEnrollments = all("select * from elective_enrollments order by course_id, student_id");
  const taskStatuses = all(`
    select t.*, s.name as student_name, s.student_no
    from student_task_status t
    join students s on s.id = t.student_id
    order by t.class_name, cast(s.student_no as integer), s.student_no
  `);
  const seating = all(`
    select a.*, s.name as student_name, s.student_no, s.gender, s.height_cm, s.seating_remark, s.is_observed
    from seating_assignments a
    join students s on s.id = a.student_id
    order by a.class_name, a.seat_key
  `);
  const seatingSnapshots = all(
    "select id, class_name, label, seat_count, created_at from seating_snapshots order by class_name, datetime(created_at) desc"
  );
  const familyCommunications = all(`
    select fc.*, f.original_name, f.saved_path, f.extracted_text
    from family_communications fc
    left join files f on f.id = fc.attachment_file_id
    order by fc.communication_date desc, fc.id desc
  `);
  const familyCommittee = all("select * from family_committee order by class_name, id asc");
  const familyActivities = all(`
    select fa.*, f.original_name as activity_file_name, f.saved_path as activity_file_path, f.extracted_text as activity_file_text
    from family_activities fa
    left join files f on f.id = fa.attachment_file_id
    order by fa.activity_date desc, fa.id desc
  `);
  const leaveRecords = all(`
    select lr.*, s.student_no
    from leave_records lr
    left join students s on s.id = lr.student_id
    order by lr.leave_date desc, lr.id desc
  `);
  const studentResumes = all("select * from files where kind = 'student-resume' order by id desc");

  const today = new Date().getDay();
  const dayIndex = today >= 1 && today <= 5 ? today - 1 : 0;
  const todayCourses = personalSchedule.filter((cell) => cell.day_index === dayIndex && cell.title);
  const examDutyCount = personalSchedule.filter((cell) => cell.title.includes("监考") || cell.tag.includes("监考")).length;

  return {
    appInfo: {
      dbPath,
      dataDir,
      attachmentsDir,
      exportsDir
    },
    appConfig: {
      ...appConfig,
      currentWeekLabel: scheduleMeta.weekLabel,
      teachingClasses: appConfig.teachingClasses?.length ? appConfig.teachingClasses : ["演示1班", "演示2班"],
      setupReviewPending: getSetting("setupReviewPending", "") === "1"
    },
    scheduleMeta,
    rosterImportInfo,
    students,
    schedules: {
      class: classSchedule,
      personal: personalSchedule
    },
    electives: {
      courses: electiveCourses,
      enrollments: electiveEnrollments
    },
    scheduleStats: {
      weeklyTotal: personalSchedule.filter((cell) => cell.title).length,
      todayCourses: todayCourses.length,
      experimentCount: examDutyCount,
      changeCount: changes.length,
      subjectTeachingCount: personalSchedule.filter((cell) => cell.title.includes(appConfig.subject)).length,
      classMeetingCount: classSchedule.filter((cell) => cell.class_name === appConfig.grade && cell.title.includes("班会")).length,
      examDutyCount
    },
    changes,
    files,
    studentResumes,
    logs,
    classTodos,
    familyCommunications,
    familyCommittee,
    familyActivities,
    leaveRecords,
    seating,
    seatingSnapshots,
    cooperation: getCooperationData(),
    familyStats: {
      total: familyCommunications.length,
      homeVisit: familyCommunications.filter((item) => item.category === "家访").length,
      leaveNotes: familyCommunications.filter((item) => item.category.includes("请假")).length,
      pending: familyCommunications.filter((item) => item.status !== "已完成").length
    },
      subject: {
        plans: subjectPlans,
        homework: homeworkTasks,
        recitations: recitationTasks,
        assessments: assessmentTests,
        assessmentScores,
        taskStatuses,
        stats: {
          planTotal: subjectPlans.length,
          planDone: subjectPlans.filter((item) => item.is_done).length,
        homeworkTotal: homeworkTasks.length,
        homeworkPending: homeworkTasks.reduce((sum, item) => sum + Math.max(0, item.assigned_count - item.submitted_count), 0),
        homeworkIssue: homeworkTasks.reduce((sum, item) => sum + Number(item.issue_count || 0), 0)
      }
    }
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: "教师工作台",
    backgroundColor: "#f5f9fd",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(rootDir, "dist", "index.html"));
  }
}

ipcMain.handle("app:get-bootstrap-data", () => getBootstrapData());
ipcMain.handle("app:get-data-location", () => ({ dbPath, dataDir, attachmentsDir, exportsDir }));
ipcMain.handle("app:ack-setup-review", () => {
  setSetting("setupReviewPending", "0");
  return getBootstrapData();
});
ipcMain.handle("app:choose-folder", async () => {
  // 允许一次选择多个文件夹，也允许直接选具体文件（不是每类资料都整整齐齐放在一个文件夹里）
  const result = await dialog.showOpenDialog({
    title: "选择文件夹或文件（可多选）",
    properties: ["openDirectory", "openFile", "multiSelections", "createDirectory"]
  });
  if (result.canceled) return [];
  return result.filePaths || [];
});

async function updateMappedDataFromFolders(options = {}) {
  const config = getAppConfig();
  if (hasFolderValue(config.dataFolders?.roster)) {
    importRosterFromFolder(config.dataFolders.roster, options);
    const importedClasses = all("select distinct class_name from students where coalesce(class_name, '') != '' order by class_name").map((row) => row.class_name);
    if (importedClasses.length) {
      const nextConfig = { ...getAppConfig(), dataMode: "local", teachingClasses: importedClasses, grade: importedClasses[0] || getAppConfig().grade };
      setSetting("appConfig", nextConfig);
      setSetting("scheduleMeta", {
        ...getSetting("scheduleMeta", {}),
        className: nextConfig.grade,
        term: `2026 学年${nextConfig.termPart}`,
        weekLabel: getWeekLabel(nextConfig)
      });
    }
  }
  if (hasFolderValue(config.dataFolders?.resume)) importStudentResumes(config.dataFolders.resume, options);
  if (hasFolderValue(config.dataFolders?.homeVisit)) await importHomeVisitArchive(config.dataFolders.homeVisit, options);
  if (hasFolderValue(config.dataFolders?.schedule)) importSchedulesFromFolder(config.dataFolders.schedule, options);
  ensureCooperationGroups();
  recalculatePlanWeeks(getAppConfig());
  persist();
}

ipcMain.handle("app:update-data", async () => {
  try {
    await updateMappedDataFromFolders({ force: true });
  } catch (error) {
    console.error("一键更新数据失败：", error);
    throw error;
  }
  return getBootstrapData();
});

ipcMain.handle("app:save-config", async (_event, payload) => {
  syncPersonalScheduleSubject(payload.subject);
  const hasRosterFolder = hasFolderValue(payload.dataFolders?.roster);
  // 老师在设置里自己填的任教班级优先；只有完全没填过班级、又配置了学生名单文件夹时，
  // 才用一个占位默认值兜底（导入完成后马上会被数据库里真实识别到的班级覆盖）。
  const submittedClasses = Array.isArray(payload.teachingClasses) ? payload.teachingClasses.map((item) => String(item).trim()).filter(Boolean) : [];
  let config = {
    ...defaultAppConfig(),
    ...payload,
    configured: true,
    teachingWeeks: Number(payload.teachingWeeks || 20),
    dataMode: hasRosterFolder ? "local" : "demo",
    teachingClasses: submittedClasses.length ? submittedClasses : hasRosterFolder ? ["预备5班", "预备6班"] : ["演示1班", "演示2班"]
  };
  setSetting("appConfig", config);
  setSetting("setupReviewPending", "0");
  // 下面几步都是读老师自己电脑上的文件（名单/简历/家访归档），文件格式、内容五花八门，
  // 任何一步读取/解析出错都不该把整个"保存设置"卡死——所以分别包一层 try/catch，
  // 某一类资料导入失败就跳过它，其余设置照常保存成功，出错详情打到日志里方便后续排查。
  if (hasRosterFolder) {
    try {
      importRosterFromFolder(config.dataFolders.roster, { force: true });
    } catch (error) {
      console.error("导入学生名单失败：", error);
    }
    const importedClasses = all("select distinct class_name from students where coalesce(class_name, '') != '' order by class_name").map((row) => row.class_name);
    if (importedClasses.length) {
      config = { ...config, dataMode: "local", grade: importedClasses[0], teachingClasses: importedClasses };
      setSetting("appConfig", config);
    }
  }
  if (hasFolderValue(config.dataFolders?.resume)) {
    try {
      importStudentResumes(config.dataFolders.resume, { force: true });
    } catch (error) {
      console.error("导入学生简历失败：", error);
    }
  }
  if (hasFolderValue(config.dataFolders?.homeVisit)) {
    try {
      await importHomeVisitArchive(config.dataFolders.homeVisit, { force: true });
    } catch (error) {
      console.error("导入家访归档失败：", error);
    }
  }
  if (hasFolderValue(config.dataFolders?.schedule)) {
    try {
      importSchedulesFromFolder(config.dataFolders.schedule, { force: true });
    } catch (error) {
      console.error("导入课表失败：", error);
    }
  }
  ensureCooperationGroups();
  setSetting("scheduleMeta", {
    ...getSetting("scheduleMeta", {}),
    className: config.grade,
    term: `2026 学年${config.termPart}`,
    weekLabel: getWeekLabel(config)
  });
  recalculatePlanWeeks(config);
  run("update subject_weekly_plans set subject = $subject where subject = '' or subject is null or subject in ('物理','语文')", { $subject: config.subject });
  run("update homework_tasks set subject = $subject where subject = '' or subject is null or subject in ('物理','语文')", { $subject: config.subject });
  return getBootstrapData();
});

ipcMain.handle("schedule:save-meta", (_event, payload) => {
  setSetting("scheduleMeta", payload);
  persist();
  return getBootstrapData();
});

ipcMain.handle("schedule:save-cell", (_event, payload) => {
  const className = payload.scope === "class" ? (payload.class_name || getAppConfig().grade || "") : "";
  const previous = first(
    "select title, teacher from schedule_cells where scope = $scope and class_name = $className and day_index = $day and period_index = $period",
    { $scope: payload.scope, $className: className, $day: payload.day_index, $period: payload.period_index }
  );
  run(
    `insert into schedule_cells (scope, class_name, day_index, period_index, time_label, title, teacher, location, tag, bg_color, note)
     values ($scope, $className, $day, $period, $time, $title, $teacher, $location, $tag, $bgColor, $note)
     on conflict(scope, class_name, day_index, period_index) do update set
       time_label = excluded.time_label,
       title = excluded.title,
       teacher = excluded.teacher,
       location = excluded.location,
       tag = excluded.tag,
       bg_color = excluded.bg_color,
       note = excluded.note`,
    {
      $scope: payload.scope,
      $className: className,
      $day: payload.day_index,
      $period: payload.period_index,
      $time: payload.time_label || "",
      $title: payload.title || "",
      $teacher: payload.teacher || "",
      $location: payload.location || "",
      $tag: payload.tag || "",
      $bgColor: payload.bg_color || "",
      $note: payload.note || ""
    }
  );
  db.run(
    "update schedule_cells set time_label = $time where scope = $scope and class_name = $className and period_index = $period",
    {
      $time: payload.time_label || "",
      $scope: payload.scope,
      $className: className,
      $period: payload.period_index
    }
  );
  const cleanTeacher = payload.teacher || "";
  const subjectTitle = payload.title || previous?.title || "";
  if (cleanTeacher && subjectTitle) {
    db.run(
      "update schedule_cells set teacher = $teacher where scope = $scope and class_name = $className and title = $title",
      { $teacher: cleanTeacher, $scope: payload.scope, $className: className, $title: subjectTitle }
    );
  }
  persist();
  return getBootstrapData();
});

ipcMain.handle("schedule:apply-subject-color", (_event, payload) => {
  const subjects = Array.isArray(payload.subjects) && payload.subjects.length
    ? payload.subjects
    : [payload.subject || getAppConfig().subject || "语文"];
  const scope = payload.scope || "";
  const className = scope === "class" ? (payload.class_name || getAppConfig().grade || "") : "";
  const update = db.prepare(`
    update schedule_cells
    set bg_color = $bgColor
    where ($scope = '' or scope = $scope)
      and (scope != 'class' or class_name = $className)
      and (title = $subject or title like $pattern)
  `);
  for (const subject of subjects.map((item) => String(item || "").trim()).filter(Boolean)) {
    update.run({
      $bgColor: Object.prototype.hasOwnProperty.call(payload, "bg_color") ? payload.bg_color : "#bae6fd",
      $scope: scope,
      $className: className,
      $subject: subject,
      $pattern: `%${subject}%`
    });
  }
  update.free();
  persist();
  return getBootstrapData();
});

ipcMain.handle("schedule:add-change", (_event, payload) => {
  const appConfig = getAppConfig();
  const weekLabel = payload.week_label || getWeekLabelForDate(appConfig, payload.change_date);
  const dayIndex = payload.day_index === "" || payload.day_index == null ? null : Number(payload.day_index);
  const periodIndex = payload.period_index === "" || payload.period_index == null ? null : Number(payload.period_index);
  const targetDayIndex = payload.target_day_index === "" || payload.target_day_index == null ? null : Number(payload.target_day_index);
  const targetPeriodIndex = payload.target_period_index === "" || payload.target_period_index == null ? null : Number(payload.target_period_index);
  run(
    `insert into schedule_changes (
       change_date, scope, original_course, new_course, partner, reason,
       week_label, change_type, day_index, period_index, target_day_index, target_period_index, created_at
     )
     values (
       $date, $scope, $original, $newCourse, $partner, $reason,
       $week, $type, $day, $period, $targetDay, $targetPeriod, datetime('now')
     )`,
    {
      $date: payload.change_date,
      $scope: payload.scope,
      $original: payload.original_course,
      $newCourse: payload.new_course,
      $partner: payload.partner || "",
      $reason: payload.reason || "",
      $week: weekLabel,
      $type: payload.change_type || "换课",
      $day: dayIndex,
      $period: periodIndex,
      $targetDay: targetDayIndex,
      $targetPeriod: targetPeriodIndex
    }
  );
  return getBootstrapData();
});

ipcMain.handle("schedule:import-screenshot", async (_event, payload) => {
  if (!payload?.path) return getBootstrapData();
  const originalName = path.basename(payload.path);
  const extension = path.extname(originalName).toLowerCase();
  const isSpreadsheet = [".xlsx", ".xls", ".csv"].includes(extension);
  const target = path.join(attachmentsDir, `${Date.now()}-${originalName}`);
  fs.copyFileSync(payload.path, target);
  run(
    "insert into files (kind, original_name, saved_path, created_at) values ($kind, $name, $saved, datetime('now'))",
    { $kind: isSpreadsheet ? "schedule-excel" : "schedule-image", $name: originalName, $saved: target }
  );
  if (isSpreadsheet) {
    importScheduleWorkbook(payload.path, payload.scope || "class", payload.class_name || "");
  }
  return getBootstrapData();
});

ipcMain.handle("elective:add-course", (_event, payload) => {
  run(
    `insert into elective_courses (class_name, course_name, course_time, location, note)
     values ($className, $name, $time, $location, $note)`,
    {
      $className: payload.class_name || "预备5班",
      $name: payload.course_name || "新探究课",
      $time: payload.course_time || "",
      $location: payload.location || "",
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("elective:update-course", (_event, payload) => {
  run(
    `update elective_courses set
      course_name = $name,
      course_time = $time,
      location = $location,
      note = $note
     where id = $id`,
    {
      $name: payload.course_name || "未命名课程",
      $time: payload.course_time || "",
      $location: payload.location || "",
      $note: payload.note || "",
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("elective:toggle-enrollment", (_event, payload) => {
  const existing = first(
    "select id from elective_enrollments where course_id = $courseId and student_id = $studentId",
    { $courseId: payload.course_id, $studentId: payload.student_id }
  );
  if (existing) {
    run("delete from elective_enrollments where id = $id", { $id: existing.id });
  } else {
    run(
      `insert into elective_enrollments (course_id, student_id, class_name, updated_at)
       values ($courseId, $studentId, $className, datetime('now'))`,
      { $courseId: payload.course_id, $studentId: payload.student_id, $className: payload.class_name || "预备5班" }
    );
  }
  return getBootstrapData();
});

ipcMain.handle("subject:add-plan", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `insert into subject_weekly_plans (week_label, plan_date, subject, class_name, lesson_type, lesson_title, lesson_goal, resources, note, is_done)
     values ($week, $date, $subject, $className, $lessonType, $title, $goal, $resources, $note, 0)`,
    {
      $week: getWeekLabelForDate(appConfig, payload.plan_date),
      $date: payload.plan_date,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $lessonType: payload.lesson_type || "新授课",
      $title: payload.lesson_title,
      $goal: payload.lesson_goal || "",
      $resources: payload.resources || "",
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:toggle-plan", (_event, payload) => {
  const nextDone = payload.is_done ? 1 : 0;
  run(
    "update subject_weekly_plans set is_done = $done, done_at = case when $done = 1 then datetime('now') else null end where id = $id",
    { $done: nextDone, $id: payload.id }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:update-plan", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `update subject_weekly_plans set
      week_label = $week,
      plan_date = $date,
      subject = $subject,
      class_name = $className,
      lesson_type = $lessonType,
      lesson_title = $title,
      lesson_goal = $goal,
      resources = $resources,
      note = $note
     where id = $id`,
    {
      $week: getWeekLabelForDate(appConfig, payload.plan_date),
      $date: payload.plan_date,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $lessonType: payload.lesson_type || "新授课",
      $title: payload.lesson_title,
      $goal: payload.lesson_goal || "",
      $resources: payload.resources || "",
      $note: payload.note || "",
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:delete-plan", (_event, payload) => {
  run("delete from subject_weekly_plans where id = $id", { $id: payload.id });
  return getBootstrapData();
});

ipcMain.handle("subject:add-homework", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `insert into homework_tasks (title, subject, class_name, assign_date, due_date, assigned_count, submitted_count, checked_count, issue_count, note, status, homework_type, is_done)
     values ($title, $subject, $className, $assignDate, $dueDate, $assigned, 0, 0, 0, $note, '进行中', $homeworkType, 0)`,
    {
      $title: payload.title,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $assignDate: payload.assign_date,
      $dueDate: payload.due_date,
      $assigned: payload.assigned_count || 0,
      $note: payload.note || "",
      $homeworkType: payload.homework_type || "日常作业"
    }
  );
  return getBootstrapData();
});

ipcMain.handle("family:add-communication", async (_event, payload) => {
  let fileId = null;
  const category = Array.isArray(payload.category) ? payload.category.join("、") : payload.category || "";
  if (payload.attachment_path && fs.existsSync(payload.attachment_path)) {
    const originalName = path.basename(payload.attachment_path);
    fileId = await createFileRecord("family-communication", payload.attachment_path, originalName);
  }

  db.run(
    `insert into family_communications (
      communication_date, student_id, student_name, contact_person, relation, channel, category,
      title, content, follow_up_date, status, attachment_file_id, created_at
    ) values (
      $date, $studentId, $studentName, $contact, $relation, $channel, $category,
      $title, $content, $followUp, $status, $fileId, datetime('now')
    )`,
    {
      $date: payload.communication_date,
      $studentId: payload.student_id || null,
      $studentName: payload.student_name || "",
      $contact: payload.contact_person || "",
      $relation: payload.relation || "",
      $channel: payload.channel || "",
      $category: category,
      $title: payload.title,
      $content: payload.content || "",
      $followUp: payload.follow_up_date || "",
      $status: payload.status || "待跟进",
      $fileId: fileId
    }
  );
  const familyId = first("select last_insert_rowid() as id")?.id || null;
  if (category.includes("请假") || payload.is_leave) {
    const student = payload.student_id ? first("select * from students where id = $id", { $id: payload.student_id }) : null;
    db.run(
      `insert into leave_records (leave_date, student_id, student_name, class_name, period_label, leave_type, remark, family_communication_id, created_at)
       values ($date, $studentId, $studentName, $className, $period, $type, $remark, $familyId, datetime('now'))`,
      {
        $date: payload.communication_date,
        $studentId: student?.id || payload.student_id || null,
        $studentName: student?.name || payload.student_name || "",
        $className: student?.class_name || "",
        $period: payload.leave_period || "全天",
        $type: payload.leave_type || "病假",
        $remark: payload.leave_remark || payload.content || "",
        $familyId: familyId
      }
    );
  }
  persist();
  return getBootstrapData();
});

ipcMain.handle("family:update-communication", (_event, payload) => {
  run(
    `update family_communications set
      communication_date = $date,
      student_id = $studentId,
      student_name = $studentName,
      contact_person = $contact,
      relation = $relation,
      channel = $channel,
      category = $category,
      title = $title,
      content = $content,
      follow_up_date = $followUp,
      deadline_date = $deadline,
      status = $status
     where id = $id`,
    {
      $date: payload.communication_date || todayIso(),
      $studentId: payload.student_id || null,
      $studentName: payload.student_name || "",
      $contact: payload.contact_person || "",
      $relation: payload.relation || "",
      $channel: payload.channel || "",
      $category: Array.isArray(payload.category) ? payload.category.join("、") : payload.category || "",
      $title: payload.title || "",
      $content: payload.content || "",
      $followUp: payload.follow_up_date || "",
      $deadline: payload.deadline_date || "",
      $status: payload.status || "待跟进",
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("family:delete-communication", (_event, payload) => {
  run("delete from family_communications where id = $id", { $id: payload.id });
  return getBootstrapData();
});

ipcMain.handle("family:add-committee", (_event, payload) => {
  run(
    `insert into family_committee (class_name, student_name, relation, parent_name, role, phone, note, created_at)
     values ($className, $studentName, $relation, $parentName, $role, $phone, $note, datetime('now'))`,
    {
      $className: payload.class_name || "预备5班",
      $studentName: payload.student_name || "",
      $relation: payload.relation || "妈妈",
      $parentName: payload.parent_name || "",
      $role: payload.role || "",
      $phone: payload.phone || "",
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("family:update-committee", (_event, payload) => {
  run(
    `update family_committee set
      class_name = $className,
      student_name = $studentName,
      relation = $relation,
      parent_name = $parentName,
      role = $role,
      phone = $phone,
      note = $note
     where id = $id`,
    {
      $className: payload.class_name || "预备5班",
      $studentName: payload.student_name || "",
      $relation: payload.relation || "妈妈",
      $parentName: payload.parent_name || "",
      $role: payload.role || "",
      $phone: payload.phone || "",
      $note: payload.note || "",
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("family:add-activity", async (_event, payload) => {
  const fileId = payload.attachment_path && fs.existsSync(payload.attachment_path)
    ? await createFileRecord("family-activity", payload.attachment_path, path.basename(payload.attachment_path))
    : null;
  run(
    `insert into family_activities (class_name, activity_date, title, activity_type, description, parent_division, status, attachment_file_id, created_at)
     values ($className, $date, $title, $type, $description, $division, $status, $fileId, datetime('now'))`,
    {
      $className: payload.class_name || "预备5班",
      $date: payload.activity_date || todayIso(),
      $title: payload.title || "",
      $type: payload.activity_type || "班级活动",
      $description: payload.description || "",
      $division: payload.parent_division || "",
      $status: payload.status || "筹备中",
      $fileId: fileId
    }
  );
  return getBootstrapData();
});

ipcMain.handle("family:update-activity", async (_event, payload) => {
  const fileId = payload.attachment_path && fs.existsSync(payload.attachment_path)
    ? await createFileRecord("family-activity", payload.attachment_path, path.basename(payload.attachment_path))
    : payload.attachment_file_id || null;
  run(
    `update family_activities set
      class_name = $className,
      activity_date = $date,
      title = $title,
      activity_type = $type,
      description = $description,
      parent_division = $division,
      status = $status,
      attachment_file_id = $fileId
     where id = $id`,
    {
      $className: payload.class_name || "预备5班",
      $date: payload.activity_date || todayIso(),
      $title: payload.title || "",
      $type: payload.activity_type || "班级活动",
      $description: payload.description || "",
      $division: payload.parent_division || "",
      $status: payload.status || "筹备中",
      $fileId: fileId,
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("class:add-todo", async (_event, payload) => {
  let fileId = null;
  if (payload.credential_path && fs.existsSync(payload.credential_path)) {
    fileId = await createFileRecord("class-todo-credential", payload.credential_path, path.basename(payload.credential_path));
  }

  let workLogId = null;
  if (payload.sync_work_log !== false) {
    db.run(
      "insert into work_logs (log_date, type, title, content) values ($date, $type, $title, $content)",
      {
        $date: payload.todo_date,
        $type: payload.area === "其他" ? "其他事务" : "班级待办",
        $title: payload.title,
        $content: [payload.requirement, payload.detail].filter(Boolean).join("；")
      }
    );
    workLogId = first("select last_insert_rowid() as id")?.id || null;
  }

  const studentIds = Array.isArray(payload.student_ids) && payload.student_ids.length
    ? payload.student_ids
    : payload.student_id ? [payload.student_id] : [];
  let familyCommunicationId = null;
  if (payload.sync_family && studentIds.length) {
    for (const studentId of studentIds) {
      const student = first("select * from students where id = $id", { $id: studentId });
      if (!student) continue;
    db.run(
      `insert into family_communications (
        communication_date, student_id, student_name, contact_person, relation, channel, category,
        title, content, follow_up_date, status, attachment_file_id, created_at
      ) values (
        $date, $studentId, $studentName, $contact, $relation, '工作台同步', $category,
        $title, $content, '', '待跟进', $fileId, datetime('now')
      )`,
      {
        $date: payload.todo_date,
        $studentId: student?.id || null,
        $studentName: student?.name || "",
        $contact: student?.guardian || "",
        $relation: student?.guardian_relation || "",
        $category: payload.is_leave ? "请假记录" : "重要通知",
        $title: payload.title,
        $content: [payload.requirement, payload.detail].filter(Boolean).join("\n"),
        $fileId: fileId
      }
    );
    familyCommunicationId = first("select last_insert_rowid() as id")?.id || null;
      if (payload.is_leave) {
        db.run(
          `insert into leave_records (leave_date, student_id, student_name, class_name, period_label, leave_type, remark, family_communication_id, created_at)
           values ($date, $studentId, $studentName, $className, $period, $type, $remark, $familyId, datetime('now'))`,
          {
            $date: payload.todo_date,
            $studentId: student.id,
            $studentName: student.name,
            $className: student.class_name || "",
            $period: payload.leave_period || "全天",
            $type: payload.leave_type || "病假",
            $remark: payload.leave_remark || payload.detail || payload.requirement || "",
            $familyId: familyCommunicationId
          }
        );
      }
    }
  }

  db.run(
    `insert into class_todos (
      todo_date, area, title, requirement, detail, credential_file_id, sync_work_log,
      sync_family, student_id, family_communication_id, work_log_id, created_at
    ) values (
      $date, $area, $title, $requirement, $detail, $fileId, $syncLog,
      $syncFamily, $studentId, $familyId, $workLogId, datetime('now')
    )`,
    {
      $date: payload.todo_date,
      $area: payload.area || "班主任",
      $title: payload.title,
      $requirement: payload.requirement || "",
      $detail: payload.detail || "",
      $fileId: fileId,
      $syncLog: payload.sync_work_log === false ? 0 : 1,
      $syncFamily: payload.sync_family ? 1 : 0,
      $studentId: studentIds[0] || null,
      $familyId: familyCommunicationId,
      $workLogId: workLogId
    }
  );
  persist();
  return getBootstrapData();
});

ipcMain.handle("class:update-todo", async (_event, payload) => {
  let fileId = payload.credential_file_id || null;
  if (payload.credential_path && fs.existsSync(payload.credential_path)) {
    fileId = await createFileRecord("class-todo-credential", payload.credential_path, path.basename(payload.credential_path));
  }
  run(
    `update class_todos set
      todo_date = $date,
      area = $area,
      title = $title,
      requirement = $requirement,
      detail = $detail,
      credential_file_id = $fileId,
      sync_work_log = $syncLog,
      sync_family = $syncFamily
     where id = $id`,
    {
      $date: payload.todo_date,
      $area: payload.area || "班主任",
      $title: payload.title,
      $requirement: payload.requirement || "",
      $detail: payload.detail || "",
      $fileId: fileId,
      $syncLog: payload.sync_work_log === false || payload.sync_work_log === 0 ? 0 : 1,
      $syncFamily: payload.sync_family ? 1 : 0,
      $id: payload.id
    }
  );
  if (payload.work_log_id) {
    run(
      "update work_logs set log_date = $date, title = $title, content = $content, updated_at = datetime('now') where id = $id",
      {
        $date: payload.todo_date,
        $title: payload.title,
        $content: [payload.requirement, payload.detail].filter(Boolean).join("；"),
        $id: payload.work_log_id
      }
    );
  }
  persist();
  return getBootstrapData();
});

ipcMain.handle("class:delete-todo", (_event, payload) => {
  const row = first("select work_log_id from class_todos where id = $id", { $id: payload.id });
  db.run("delete from class_todos where id = $id", { $id: payload.id });
  if (payload.delete_linked && row?.work_log_id) {
    db.run("delete from work_logs where id = $id", { $id: row.work_log_id });
  }
  persist();
  return getBootstrapData();
});

function normalizeLogTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean).join("、");
  return String(tags || "").trim();
}

ipcMain.handle("logs:add", async (_event, payload) => {
  let evidenceFileId = null;
  if (payload.evidence_path && fs.existsSync(payload.evidence_path)) {
    evidenceFileId = await createFileRecord("work-log-evidence", payload.evidence_path, path.basename(payload.evidence_path));
  }
  run(
    `insert into work_logs (log_date, type, title, content, status, tags, remark, requirement, evidence_file_id, updated_at)
     values ($date, $type, $title, $content, $status, $tags, $remark, $requirement, $evidenceFileId, datetime('now'))`,
    {
      $date: payload.log_date || todayIso(),
      $type: payload.type || "班级管理",
      $title: payload.title || "",
      $content: payload.content || "",
      $status: payload.status || "未开始",
      $tags: normalizeLogTags(payload.tags),
      $remark: payload.remark || "",
      $requirement: payload.requirement || "",
      $evidenceFileId: evidenceFileId
    }
  );
  return getBootstrapData();
});

ipcMain.handle("logs:update", async (_event, payload) => {
  let evidenceFileId = payload.evidence_file_id || null;
  if (payload.evidence_path && fs.existsSync(payload.evidence_path)) {
    evidenceFileId = await createFileRecord("work-log-evidence", payload.evidence_path, path.basename(payload.evidence_path));
  }
  run(
    `update work_logs set
      log_date = $date,
      type = $type,
      title = $title,
      content = $content,
      status = $status,
      tags = $tags,
      remark = $remark,
      requirement = $requirement,
      evidence_file_id = $evidenceFileId,
      updated_at = datetime('now')
     where id = $id`,
    {
      $date: payload.log_date || todayIso(),
      $type: payload.type || "班级管理",
      $title: payload.title || "",
      $content: payload.content || "",
      $status: payload.status || "未开始",
      $tags: normalizeLogTags(payload.tags),
      $remark: payload.remark || "",
      $requirement: payload.requirement || "",
      $evidenceFileId: evidenceFileId,
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("logs:delete", (_event, payload) => {
  run("delete from work_logs where id = $id", { $id: payload.id });
  return getBootstrapData();
});

ipcMain.handle("students:print-roster-pdf", async (_event, payload) => {
  const className = payload?.className || "预备5班";
  const students = all("select * from students where class_name = $className order by cast(student_no as integer), student_no, id", {
    $className: className
  });
  const rows = students.map((student) => `
    <tr>
      <td>${escapeHtml(student.student_no)}</td>
      <td class="name">${escapeHtml(student.name)}</td>
      <td>${escapeHtml(student.roles)}</td>
      <td>${escapeHtml(student.guardian_phone || student.phone || student.father_phone || student.mother_phone)}</td>
      <td>${escapeHtml(student.student_remark)}</td>
    </tr>
  `).join("");
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #17324d; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
          header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 10px; }
          h1 { margin: 0; color: #0c4078; font-size: 22px; }
          .meta { color: #718195; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
          th, td { border: 1px solid #9db8d0; padding: 6px 7px; height: 28px; vertical-align: middle; }
          th { background: #e8f2fb; color: #0c4078; font-weight: 800; }
          td { word-break: break-word; }
          th:nth-child(1), td:nth-child(1) { width: 48px; text-align: center; }
          th:nth-child(2), td:nth-child(2) { width: 76px; }
          th:nth-child(3), td:nth-child(3) { width: 150px; }
          th:nth-child(4), td:nth-child(4) { width: 130px; }
          .name { font-weight: 700; color: #0c4078; }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapeHtml(className)}学生名单</h1>
          <div class="meta">共 ${students.length} 人 · 生成时间 ${new Date().toLocaleString("zh-CN", { hour12: false })}</div>
        </header>
        <table>
          <thead>
            <tr><th>学号</th><th>姓名</th><th>班干部</th><th>联系方式</th><th>备注</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
  const defaultPath = path.join(resolveExportsDir(), `${className}学生名单-A4.pdf`);
  const result = await dialog.showSaveDialog({
    title: "导出学生名单 PDF",
    defaultPath,
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
  });
  await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdf = await pdfWindow.webContents.printToPDF({
    pageSize: "A4",
    landscape: true,
    printBackground: true,
    margins: { marginType: "none" }
  });
  fs.writeFileSync(result.filePath, pdf);
  pdfWindow.destroy();
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("students:update-remark", (_event, payload) => {
  run("update students set student_remark = $remark where id = $id", {
    $remark: payload.remark || "",
    $id: payload.id
  });
  return getBootstrapData();
});

ipcMain.handle("students:update-profile", (_event, payload) => {
  run("update students set height_cm = $height, seating_remark = $remark, is_observed = $observed where id = $id", {
    $height: payload.height_cm || "",
    $remark: payload.seating_remark || "",
    $observed: payload.is_observed ? 1 : 0,
    $id: payload.id
  });
  return getBootstrapData();
});

ipcMain.handle("students:update-roles", (_event, payload) => {
  run("update students set roles = $roles where id = $id", {
    $roles: payload.roles || "",
    $id: payload.id
  });
  return getBootstrapData();
});

const filePreviewMimeByExt = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf"
};

// 花名册“点击学生查看简历”用：把本地文件读成 base64 data URL 直接传给渲染进程显示，
// 避免在渲染层直接拼 file:// 路径（受 webSecurity 限制，且不必让渲染进程知道真实磁盘路径）。
ipcMain.handle("files:read-preview", (_event, payload) => {
  const row = first("select id, saved_path, original_name from files where id = $id", { $id: payload.id });
  if (!row || !row.saved_path || !fs.existsSync(row.saved_path)) {
    return { ok: false, reason: "文件不存在或暂时无法访问（映射的原始文件夹可能未同步/已改名）" };
  }
  const ext = path.extname(row.saved_path).toLowerCase();
  const mime = filePreviewMimeByExt[ext] || "application/octet-stream";
  try {
    const buffer = fs.readFileSync(row.saved_path);
    return {
      ok: true,
      mime,
      isImage: mime.startsWith("image/"),
      originalName: row.original_name,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`
    };
  } catch (error) {
    return { ok: false, reason: error?.message || "文件读取失败" };
  }
});

// 用系统默认程序打开（比如 PDF 简历），不在应用内内嵌预览
ipcMain.handle("files:open-external", (_event, payload) => {
  const row = first("select saved_path from files where id = $id", { $id: payload.id });
  if (!row || !row.saved_path || !fs.existsSync(row.saved_path)) {
    return { ok: false, reason: "文件不存在或暂时无法访问" };
  }
  shell.openPath(row.saved_path);
  return { ok: true };
});

ipcMain.handle("seating:assign", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  const studentId = payload.student_id;
  if (!studentId) return getBootstrapData();
  db.run("delete from seating_assignments where class_name = $className and (student_id = $studentId or seat_key = $seatKey)", {
    $className: className,
    $studentId: studentId,
    $seatKey: payload.seat_key || ""
  });
  if (payload.seat_key) {
    run(
      "insert into seating_assignments (class_name, seat_key, student_id, updated_at) values ($className, $seatKey, $studentId, datetime('now'))",
      { $className: className, $seatKey: payload.seat_key, $studentId: studentId }
    );
  } else {
    persist();
  }
  return getBootstrapData();
});

// 一键重置：清空该班全部座位安排（含主座位区和左侧单列），学生全部回到"待选"名单。
ipcMain.handle("seating:reset", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  run("delete from seating_assignments where class_name = $className", { $className: className });
  return getBootstrapData();
});

// 主座位区是 7 列 × 7 行（seat_key 形如 r{行}c{列}），左侧"单列"是独立的一排（solo-{行}），
// 不参与随机安排/每周轮换，理由见下面两个函数里的注释。
const seatingGridRows = 7;
const seatingGridCols = 7;

function parseGridSeatKey(seatKey) {
  const match = /^r(\d+)c(\d+)$/.exec(seatKey || "");
  if (!match) return null;
  return { row: Number(match[1]), col: Number(match[2]) };
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// 男女尽量交错、但座位本身随机：两个性别分别随机打乱后再交替拼接，
// 再按“每行从第1列到第7列、行从近讲台到远讲台”的阅读顺序依次填入 7×7 主座位区。
// 只处理主座位区（不含左侧单列），且会先清空该班主座位区当前的座位安排。
ipcMain.handle("seating:randomize", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  const rows = Math.max(1, Math.min(seatingGridRows, Number(payload.rows || seatingGridRows)));
  const cols = Math.max(1, Math.min(seatingGridCols, Number(payload.cols || seatingGridCols)));
  const orderMode = payload.order_mode || "random";
  const genderMode = payload.gender_mode || "mixed";
  const students = all("select id, gender, student_no from students where class_name = $className order by cast(student_no as integer), student_no, id", { $className: className });
  if (!students.length) return getBootstrapData();

  let orderedIds = [];
  if (orderMode === "student_no") {
    orderedIds = students.map((student) => student.id);
  } else if (genderMode === "mixed") {
    const boys = shuffleInPlace(students.filter((student) => student.gender === "男").map((student) => student.id));
    const girls = shuffleInPlace(students.filter((student) => student.gender !== "男").map((student) => student.id));
    const [first, second] = boys.length >= girls.length ? [boys, girls] : [girls, boys];
    for (let i = 0; i < first.length; i += 1) {
      orderedIds.push(first[i]);
      if (second[i] != null) orderedIds.push(second[i]);
    }
  } else {
    orderedIds = shuffleInPlace(students.map((student) => student.id));
  }

  const seatKeys = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      seatKeys.push(`r${row}c${col}`);
    }
  }
  if (orderedIds.length > seatKeys.length) {
    console.warn(`[随机安排座位] ${className} 共 ${orderedIds.length} 人，超出主座位区 ${seatKeys.length} 个座位，多出的 ${orderedIds.length - seatKeys.length} 人本次不会被安排。`);
  }

  db.run("delete from seating_assignments where class_name = $className and seat_key like 'r%'", { $className: className });
  const insert = db.prepare(
    "insert into seating_assignments (class_name, seat_key, student_id, updated_at) values ($className, $seatKey, $studentId, datetime('now'))"
  );
  orderedIds.slice(0, seatKeys.length).forEach((studentId, index) => {
    insert.run({ $className: className, $seatKey: seatKeys[index], $studentId: studentId });
  });
  insert.free();
  persist();
  return getBootstrapData();
});

// 每周换座位：主座位区每一列整体向右移动一列（学生面向讲台视角），第 7 列绕回第 1 列，行不变。
// 先算出全部新座位，再整体替换，避免中途出现同一座位被两名学生同时占用导致的唯一约束冲突。
ipcMain.handle("seating:rotate-columns", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  const current = all("select seat_key, student_id from seating_assignments where class_name = $className and seat_key like 'r%'", {
    $className: className
  });
  if (!current.length) return getBootstrapData();

  const rotated = current.map((row) => {
    const parsed = parseGridSeatKey(row.seat_key);
    if (!parsed) return null;
    const nextCol = (parsed.col % seatingGridCols) + 1;
    return { seatKey: `r${parsed.row}c${nextCol}`, studentId: row.student_id };
  }).filter(Boolean);

  db.run("delete from seating_assignments where class_name = $className and seat_key like 'r%'", { $className: className });
  const insert = db.prepare(
    "insert into seating_assignments (class_name, seat_key, student_id, updated_at) values ($className, $seatKey, $studentId, datetime('now'))"
  );
  rotated.forEach(({ seatKey, studentId }) => {
    insert.run({ $className: className, $seatKey: seatKey, $studentId: studentId });
  });
  insert.free();
  persist();
  return getBootstrapData();
});

ipcMain.handle("seating:save-snapshot", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  const rows = all(
    `select a.seat_key, a.student_id, s.name as student_name, s.gender
     from seating_assignments a join students s on s.id = a.student_id
     where a.class_name = $className`,
    { $className: className }
  );
  run(
    "insert into seating_snapshots (class_name, label, seat_count, payload, created_at) values ($className, $label, $seatCount, $payload, datetime('now'))",
    {
      $className: className,
      $label: (payload.label || "").trim() || `座位表存档 ${todayIso()}`,
      $seatCount: rows.length,
      $payload: JSON.stringify(rows)
    }
  );
  return getBootstrapData();
});

ipcMain.handle("seating:get-snapshot", (_event, payload) => {
  const row = first("select * from seating_snapshots where id = $id", { $id: payload.id });
  if (!row) return { ok: false };
  let seats = [];
  try {
    seats = JSON.parse(row.payload || "[]");
  } catch {
    seats = [];
  }
  return { ok: true, id: row.id, className: row.class_name, label: row.label, createdAt: row.created_at, seats };
});

// 把某个历史版本重新应用为当前座位表（只覆盖该版本涉及的班级，且只覆盖主座位区/单列各自记录到的座位）
ipcMain.handle("seating:apply-snapshot", (_event, payload) => {
  const row = first("select * from seating_snapshots where id = $id", { $id: payload.id });
  if (!row) return getBootstrapData();
  let seats = [];
  try {
    seats = JSON.parse(row.payload || "[]");
  } catch {
    seats = [];
  }
  const currentStudentIds = new Set(all("select id from students where class_name = $className", { $className: row.class_name }).map((s) => s.id));
  db.run("delete from seating_assignments where class_name = $className", { $className: row.class_name });
  const insert = db.prepare(
    "insert into seating_assignments (class_name, seat_key, student_id, updated_at) values ($className, $seatKey, $studentId, datetime('now'))"
  );
  let restored = 0;
  seats.forEach((seat) => {
    if (!seat.seat_key || !seat.student_id || !currentStudentIds.has(seat.student_id)) return; // 学生已不在本班的座位跳过
    insert.run({ $className: row.class_name, $seatKey: seat.seat_key, $studentId: seat.student_id });
    restored += 1;
  });
  insert.free();
  persist();
  if (restored < seats.length) {
    console.warn(`[应用历史座位表] ${row.class_name} 有 ${seats.length - restored} 个座位对应的学生已不在本班花名册中，未恢复。`);
  }
  return getBootstrapData();
});

ipcMain.handle("cooperation:add-record", (_event, payload) => {
  const studentId = payload.student_id || null;
  let groupId = payload.group_id || null;
  if (studentId && !groupId) {
    groupId = first("select group_id from cooperation_members where student_id = $id", { $id: studentId })?.group_id || null;
  }
  const type = payload.type || "achievement";
  const rawPoints = Math.abs(Number(payload.points || 0));
  const points = type === "reminder" ? -rawPoints : rawPoints;
  run(
    `insert into cooperation_records (
      record_date, class_name, group_id, student_id, type, category, points, title, note, created_at
    ) values (
      $date, $className, $groupId, $studentId, $type, $category, $points, $title, $note, datetime('now')
    )`,
    {
      $date: payload.record_date,
      $className: payload.class_name || "预备5班",
      $groupId: groupId,
      $studentId: studentId,
      $type: type,
      $category: payload.category || "",
      $points: points,
      $title: payload.title,
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("cooperation:update-group", async (_event, payload) => {
  let photoFileId = payload.photo_file_id || null;
  if (payload.photo_path && fs.existsSync(payload.photo_path)) {
    photoFileId = await createFileRecord("cooperation-group-photo", payload.photo_path, path.basename(payload.photo_path));
  }
  run(
    `update cooperation_groups set
      name = $name,
      color = $color,
      goal = $goal,
      group_kind = $kind,
      photo_file_id = coalesce($photoFileId, photo_file_id)
     where id = $id`,
    {
      $name: payload.name || "未命名小组",
      $color: payload.color || "#1f67b1",
      $goal: payload.goal || "",
      $kind: payload.group_kind || "常用",
      $photoFileId: photoFileId,
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("cooperation:add-group", async (_event, payload) => {
  let photoFileId = null;
  if (payload.photo_path && fs.existsSync(payload.photo_path)) {
    photoFileId = await createFileRecord("cooperation-group-photo", payload.photo_path, path.basename(payload.photo_path));
  }
  run(
    `insert into cooperation_groups (class_name, name, color, goal, group_kind, photo_file_id)
     values ($className, $name, $color, $goal, $kind, $photoFileId)`,
    {
      $className: payload.class_name || "预备5班",
      $name: payload.name || "临时小组",
      $color: payload.color || "#1f67b1",
      $goal: payload.goal || "",
      $kind: payload.group_kind || "临时",
      $photoFileId: photoFileId
    }
  );
  return getBootstrapData();
});

ipcMain.handle("cooperation:set-members", (_event, payload) => {
  const className = payload.class_name || "预备5班";
  const assignments = payload.assignments || {};
  const students = all("select id from students where class_name = $className", { $className: className }).map((student) => String(student.id));
  const seen = new Set();
  for (const studentIds of Object.values(assignments)) {
    for (const studentId of studentIds || []) {
      if (!students.includes(String(studentId))) continue;
      if (seen.has(String(studentId))) return { ok: false, message: "名单中有学生被重复分组，请先调整后再保存。" };
      seen.add(String(studentId));
    }
  }
  const missing = students.filter((studentId) => !seen.has(studentId));
  if (missing.length > 0) return { ok: false, message: `还有 ${missing.length} 名学生未分组，请补齐后再保存。` };

  const groups = all("select id from cooperation_groups where class_name = $className", { $className: className }).map((group) => String(group.id));
  db.run(
    `delete from cooperation_members
     where group_id in (select id from cooperation_groups where class_name = $className)`,
    { $className: className }
  );
  const insert = db.prepare("insert into cooperation_members (group_id, student_id, role) values ($groupId, $studentId, '')");
  for (const [groupId, studentIds] of Object.entries(assignments)) {
    if (!groups.includes(String(groupId))) continue;
    for (const studentId of studentIds || []) {
      insert.run({ $groupId: groupId, $studentId: studentId });
    }
  }
  insert.free();
  persist();
  return { ok: true, data: getBootstrapData() };
});

ipcMain.handle("cooperation:add-project", async (_event, payload) => {
  let fileId = null;
  if (payload.evaluation_file_path && fs.existsSync(payload.evaluation_file_path)) {
    fileId = await createFileRecord("cooperation-evaluation", payload.evaluation_file_path, path.basename(payload.evaluation_file_path));
  }
  const groupScores = payload.group_scores || (payload.group_id ? { [payload.group_id]: payload.points || 0 } : {});
  const personalScores = JSON.stringify(payload.personal_scores || {});
  const insert = db.prepare(`
    insert into cooperation_projects (
      project_date, period_label, class_name, group_id, project_name, project_type, progress, division, evaluation_note, activity_detail, personal_scores_json, points, evaluation_file_id, created_at
    ) values (
      $date, $periodLabel, $className, $groupId, $name, $type, $progress, $division, $evaluation, $detail, $personalScores, $points, $fileId, datetime('now')
    )
  `);
  for (const [groupId, points] of Object.entries(groupScores)) {
    insert.run({
      $date: payload.project_date,
      $periodLabel: payload.period_label || payload.project_date || "",
      $className: payload.class_name || "预备5班",
      $groupId: groupId || null,
      $name: payload.project_name,
      $type: payload.project_type || "日常行规",
      $progress: payload.progress || "进行中",
      $division: payload.division || "",
      $evaluation: payload.evaluation_note || "",
      $detail: payload.activity_detail || "",
      $personalScores: personalScores,
      $points: Number(points || 0),
      $fileId: fileId
    });
  }
  insert.free();
  persist();
  return getBootstrapData();
});

ipcMain.handle("cooperation:update-project", async (_event, payload) => {
  const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id].filter(Boolean);
  if (!ids.length) return getBootstrapData();
  const update = db.prepare(`
    update cooperation_projects set
      period_label = $periodLabel,
      project_name = $name,
      project_type = $type,
      progress = $progress,
      division = $division,
      evaluation_note = $evaluation,
      activity_detail = $detail,
      personal_scores_json = $personalScores,
      points = $points
    where id = $id
  `);
  const groupScores = payload.group_scores || {};
  for (const id of ids) {
    const row = first("select group_id, points from cooperation_projects where id = $id", { $id: id });
    update.run({
      $periodLabel: payload.period_label || "",
      $name: payload.project_name || "",
      $type: payload.project_type || "日常行规",
      $progress: payload.progress || "进行中",
      $division: payload.division || "",
      $evaluation: payload.evaluation_note || "",
      $detail: payload.activity_detail || "",
      $personalScores: JSON.stringify(payload.personal_scores || {}),
      $points: Number(groupScores[row?.group_id] ?? row?.points ?? 0),
      $id: id
    });
  }
  update.free();
  persist();
  return getBootstrapData();
});

ipcMain.handle("cooperation:delete-project", (_event, payload) => {
  const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id].filter(Boolean);
  if (ids.length) {
    const remove = db.prepare("delete from cooperation_projects where id = $id");
    for (const id of ids) remove.run({ $id: id });
    remove.free();
    persist();
  }
  return getBootstrapData();
});

ipcMain.handle("subject:update-homework", (_event, payload) => {
  run(
    `update homework_tasks set
      title = $title,
      subject = $subject,
      class_name = $className,
      assign_date = $assignDate,
      due_date = $dueDate,
      assigned_count = $assigned,
      submitted_count = $submitted,
      checked_count = $checked,
      issue_count = $issue,
      status = $status,
      note = $note,
      homework_type = $homeworkType,
      is_done = $done,
      done_at = case when $done = 1 then coalesce(done_at, datetime('now')) else null end
     where id = $id`,
    {
      $title: payload.title,
      $subject: payload.subject || "语文",
      $className: payload.class_name || "",
      $assignDate: payload.assign_date,
      $dueDate: payload.due_date,
      $assigned: payload.assigned_count || 0,
      $submitted: payload.submitted_count || 0,
      $checked: payload.checked_count || 0,
      $issue: payload.issue_count || 0,
      $status: payload.status || "进行中",
      $note: payload.note || "",
      $homeworkType: payload.homework_type || "日常作业",
      $done: payload.is_done ? 1 : 0,
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:delete-homework", (_event, payload) => {
  db.run("delete from homework_tasks where id = $id", { $id: payload.id });
  db.run("delete from student_task_status where task_kind = 'homework' and task_id = $id", { $id: payload.id });
  persist();
  return getBootstrapData();
});

ipcMain.handle("subject:add-recitation", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `insert into recitation_tasks (title, subject, class_name, recitation_type, assign_date, due_date, content, note, status, is_done)
     values ($title, $subject, $className, $type, $assignDate, $dueDate, $content, $note, '进行中', 0)`,
    {
      $title: payload.title,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $type: payload.recitation_type || "背诵",
      $assignDate: payload.assign_date,
      $dueDate: payload.due_date,
      $content: payload.content || "",
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:update-recitation", (_event, payload) => {
  const done = payload.is_done ? 1 : 0;
  run(
    `update recitation_tasks set
      title = $title,
      subject = $subject,
      class_name = $className,
      recitation_type = $type,
      assign_date = $assignDate,
      due_date = $dueDate,
      content = $content,
      note = $note,
      status = $status,
      is_done = $done,
      done_at = case when $done = 1 then coalesce(done_at, datetime('now')) else null end
     where id = $id`,
    {
      $title: payload.title,
      $subject: payload.subject || "语文",
      $className: payload.class_name || "",
      $type: payload.recitation_type || "背诵",
      $assignDate: payload.assign_date,
      $dueDate: payload.due_date,
      $content: payload.content || "",
      $note: payload.note || "",
      $status: payload.status || "进行中",
      $done: done,
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:delete-recitation", (_event, payload) => {
  db.run("delete from recitation_tasks where id = $id", { $id: payload.id });
  db.run("delete from student_task_status where task_kind = 'recitation' and task_id = $id", { $id: payload.id });
  persist();
  return getBootstrapData();
});

ipcMain.handle("subject:add-assessment", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `insert into assessment_tests (title, subject, class_name, test_type, test_date, excellent_score, pass_score, paper_path, note, score_columns_json)
     values ($title, $subject, $className, $type, $date, $excellent, $pass, $paper, $note, $scoreColumns)`,
    {
      $title: payload.title,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $type: payload.test_type || "单元测评",
      $date: payload.test_date,
      $excellent: Number(payload.excellent_score || 90),
      $pass: Number(payload.pass_score || 60),
      $paper: payload.paper_path || "",
      $note: payload.note || "",
      $scoreColumns: JSON.stringify(Array.isArray(payload.score_columns) ? payload.score_columns : [])
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:update-assessment", (_event, payload) => {
  const appConfig = getAppConfig();
  run(
    `update assessment_tests set
      title = $title,
      subject = $subject,
      class_name = $className,
      test_type = $type,
      test_date = $date,
      excellent_score = $excellent,
      pass_score = $pass,
      paper_path = $paper,
      note = $note,
      score_columns_json = $scoreColumns
     where id = $id`,
    {
      $title: payload.title,
      $subject: payload.subject || appConfig.subject || "语文",
      $className: payload.class_name || "",
      $type: payload.test_type || "单元测评",
      $date: payload.test_date,
      $excellent: Number(payload.excellent_score || 90),
      $pass: Number(payload.pass_score || 60),
      $paper: payload.paper_path || "",
      $note: payload.note || "",
      $scoreColumns: JSON.stringify(Array.isArray(payload.score_columns) ? payload.score_columns : []),
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:delete-assessment", (_event, payload) => {
  run("delete from assessment_tests where id = $id", { $id: payload.id });
  run("delete from assessment_scores where test_id = $testId", { $testId: String(payload.id) });
  return getBootstrapData();
});

ipcMain.handle("subject:set-assessment-score", (_event, payload) => {
  run(
    `insert into assessment_scores (test_id, student_id, class_name, score, breakdown_json, note, updated_at)
     values ($testId, $studentId, $className, $score, $breakdown, $note, datetime('now'))
     on conflict(test_id, student_id, class_name) do update set
      score = excluded.score,
      breakdown_json = excluded.breakdown_json,
      note = excluded.note,
      updated_at = datetime('now')`,
    {
      $testId: String(payload.test_id),
      $studentId: payload.student_id,
      $className: payload.class_name,
      $score: payload.score === "" ? null : Number(payload.score),
      $breakdown: JSON.stringify(payload.breakdown && typeof payload.breakdown === "object" ? payload.breakdown : {}),
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:set-task-student-status", (_event, payload) => {
  run(
    `insert into student_task_status (task_kind, task_id, student_id, class_name, is_done, praise, needs_improvement, note, updated_at)
     values ($kind, $taskId, $studentId, $className, $done, $praise, $improve, $note, datetime('now'))
     on conflict(task_kind, task_id, student_id) do update set
       is_done = excluded.is_done,
       praise = excluded.praise,
       needs_improvement = excluded.needs_improvement,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    {
      $kind: payload.task_kind,
      $taskId: payload.task_id,
      $studentId: payload.student_id,
      $className: payload.class_name,
      $done: payload.is_done ? 1 : 0,
      $praise: payload.praise ? 1 : 0,
      $improve: payload.needs_improvement ? 1 : 0,
      $note: payload.note || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("subject:export-task-student-status", async (_event, payload) => {
  const className = payload?.className || "预备5班";
  const kind = payload?.taskKind || "homework";
  const taskId = payload?.taskId || "all";
  const students = all("select * from students where class_name = $className order by cast(student_no as integer), student_no, id", { $className: className });
  const tasks = kind === "recitation"
    ? all("select * from recitation_tasks where (class_name = $className or coalesce(class_name, '') = '') order by due_date asc, id asc", { $className: className })
    : all("select * from homework_tasks where (class_name = $className or coalesce(class_name, '') = '') order by due_date asc, id asc", { $className: className });
  const filteredTasks = taskId === "all" ? tasks : tasks.filter((task) => String(task.id) === String(taskId));
  const statuses = all("select * from student_task_status where class_name = $className and task_kind = $kind", { $className: className, $kind: kind });
  const rows = [];
  for (const task of filteredTasks) {
    for (const student of students) {
      const status = statuses.find((item) => String(item.task_id) === String(task.id) && String(item.student_id) === String(student.id));
      rows.push({
        班级: className,
        任务类型: kind === "recitation" ? "背默" : "作业",
        任务名称: task.title,
        标签: task.homework_type || task.recitation_type || "",
        截止日期: task.due_date,
        学号: student.student_no,
        姓名: student.name,
        是否完成: status?.is_done ? "已完成" : "待完成",
        表扬: status?.praise ? "是" : "",
        待改进: status?.needs_improvement ? "是" : "",
        备注: status?.note || ""
      });
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 班级: className, 任务名称: "暂无可导出记录" }]), kind === "recitation" ? "背默完成情况" : "作业完成情况");
  const defaultPath = path.join(resolveExportsDir(), `${className}${kind === "recitation" ? "背默" : "作业"}完成情况.xlsx`);
  const result = await dialog.showSaveDialog({
    title: "导出完成情况",
    defaultPath,
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  XLSX.writeFile(workbook, result.filePath);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("subject:export-review", async (_event, payload) => {
  const className = payload?.className || "预备5班";
  const month = payload?.month || new Date().toISOString().slice(0, 7);
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;
  const plans = all(
    `select * from subject_weekly_plans
     where (class_name = $className or coalesce(class_name, '') = '') and plan_date >= $start and plan_date <= $end
     order by plan_date asc, id asc`,
    { $className: className, $start: startDate, $end: endDate }
  );
  const homework = all(
    `select * from homework_tasks
     where (class_name = $className or coalesce(class_name, '') = '') and assign_date >= $start and assign_date <= $end
     order by assign_date asc, id asc`,
    { $className: className, $start: startDate, $end: endDate }
  );
  const planRows = plans.map((plan) => ({
    适用范围: plan.class_name || "5班、6班同步",
    日期: plan.plan_date,
    星期: getWeekdayLabel(plan.plan_date),
    周次: plan.week_label,
    学科: plan.subject,
    标签: plan.lesson_type || "新授课",
    教学任务: plan.lesson_title,
    目标与重难点: plan.lesson_goal,
    资料: plan.resources,
    是否完成: plan.is_done ? "已完成" : "未完成",
    完成时间: plan.done_at || "",
    备注: plan.note || ""
  }));
  const homeworkRows = homework.map((task) => ({
    适用范围: task.class_name || "5班、6班同步",
    布置日期: task.assign_date,
    布置日星期: getWeekdayLabel(task.assign_date),
    截止日期: task.due_date,
    截止日星期: getWeekdayLabel(task.due_date),
    学科: task.subject,
    标签: task.homework_type || "日常作业",
    作业名称: task.title,
    应交: task.assigned_count,
    已交: task.submitted_count,
    未交: Math.max(0, task.assigned_count - task.submitted_count),
    已批: task.checked_count,
    问题数: task.issue_count,
    状态: task.status,
    是否完成: task.is_done ? "已完成" : "未完成",
    完成时间: task.done_at || "",
    备注: task.note || ""
  }));
  const overviewRows = [
    { 项目: "月份", 数值: month },
    { 项目: "班级", 数值: className },
    { 项目: "教学任务总数", 数值: plans.length },
    { 项目: "教学任务已完成", 数值: plans.filter((plan) => plan.is_done).length },
    { 项目: "新授课", 数值: plans.filter((plan) => (plan.lesson_type || "新授课") === "新授课").length },
    { 项目: "复习课", 数值: plans.filter((plan) => plan.lesson_type === "复习课").length },
    { 项目: "其他教学任务", 数值: plans.filter((plan) => plan.lesson_type === "其他").length },
    { 项目: "作业任务总数", 数值: homework.length },
    { 项目: "作业任务已完成", 数值: homework.filter((task) => task.is_done).length },
    { 项目: "作业未交人次", 数值: homework.reduce((sum, task) => sum + Math.max(0, task.assigned_count - task.submitted_count), 0) },
    { 项目: "问题作业人次", 数值: homework.reduce((sum, task) => sum + Number(task.issue_count || 0), 0) }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overviewRows), "复盘概览");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(planRows.length ? planRows : [{ 适用范围: className, 日期: "", 教学任务: "本月暂无教学任务" }]), "教学任务");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(homeworkRows.length ? homeworkRows : [{ 适用范围: className, 布置日期: "", 作业名称: "本月暂无作业任务" }]), "作业任务");

  const defaultPath = path.join(resolveExportsDir(), `${className}学科教学复盘-${month}.xlsx`);
  const result = await dialog.showSaveDialog({
    title: "导出学科教学复盘",
    defaultPath,
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  XLSX.writeFile(workbook, result.filePath);
  return { canceled: false, filePath: result.filePath, planCount: plans.length, homeworkCount: homework.length };
});

ipcMain.handle("subject:export-homework-issues", async (_event, payload) => {
  const className = payload?.className || "预备5班";
  const startDate = payload?.startDate || "1900-01-01";
  const endDate = payload?.endDate || "2999-12-31";
  const studentId = payload?.studentId || "all";
  const student = studentId === "all" ? null : first("select * from students where id = $id", { $id: studentId });
  const tasks = all(
    `select *
     from homework_tasks
     where (class_name = $className or coalesce(class_name, '') = '')
       and due_date >= $start
       and due_date <= $end
       and (issue_count > 0 or assigned_count > submitted_count or status in ('未收齐','进行中'))
     order by due_date asc, id asc`,
    { $className: className, $start: startDate, $end: endDate }
  );
  const rows = tasks.map((task) => ({
    班级: className,
    适用范围: task.class_name || "5班、6班同步",
    学生范围: student ? `${student.student_no || ""} ${student.name}`.trim() : "全班",
    布置日期: task.assign_date,
    布置日星期: getWeekdayLabel(task.assign_date),
    截止日期: task.due_date,
    截止日星期: getWeekdayLabel(task.due_date),
    学科: task.subject,
    标签: task.homework_type || "日常作业",
    作业名称: task.title,
    应交: task.assigned_count,
    已交: task.submitted_count,
    未交: Math.max(0, task.assigned_count - task.submitted_count),
    问题数: task.issue_count,
    状态: task.status,
    备注: task.note || ""
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    班级: className,
    适用范围: "",
    学生范围: student ? `${student.student_no || ""} ${student.name}`.trim() : "全班",
    布置日期: "",
    布置日星期: "",
    截止日期: "",
    截止日星期: "",
    学科: "",
    标签: "",
    作业名称: "所选时间段暂无作业问题记录",
    应交: "",
    已交: "",
    未交: "",
    问题数: "",
    状态: "",
    备注: ""
  }]);
  sheet["!cols"] = [
    { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 8 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 32 }
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "作业问题清单");
  const defaultPath = path.join(resolveExportsDir(), `${className}作业问题清单-${startDate}_${endDate}.xlsx`);
  const result = await dialog.showSaveDialog({
    title: "导出作业问题清单",
    defaultPath,
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  XLSX.writeFile(workbook, result.filePath);
  return { canceled: false, filePath: result.filePath, count: rows.length };
});

ipcMain.handle("leave:add-record", (_event, payload) => {
  const student = payload.student_id
    ? first("select * from students where id = $id", { $id: payload.student_id })
    : payload.student_name ? first("select * from students where name = $name or student_no = $name", { $name: payload.student_name }) : null;
  run(
    `insert into leave_records (leave_date, student_id, student_name, class_name, period_label, leave_type, remark, created_at)
     values ($date, $studentId, $studentName, $className, $period, $type, $remark, datetime('now'))`,
    {
      $date: payload.leave_date,
      $studentId: student?.id || payload.student_id || null,
      $studentName: student?.name || payload.student_name || "",
      $className: student?.class_name || payload.class_name || "",
      $period: payload.period_label || "全天",
      $type: payload.leave_type || "病假",
      $remark: payload.remark || ""
    }
  );
  return getBootstrapData();
});

ipcMain.handle("leave:update-record", (_event, payload) => {
  const student = payload.student_id
    ? first("select * from students where id = $id", { $id: payload.student_id })
    : payload.student_name ? first("select * from students where name = $name or student_no = $name", { $name: payload.student_name }) : null;
  run(
    `update leave_records set
      leave_date = $date,
      student_id = $studentId,
      student_name = $studentName,
      class_name = $className,
      period_label = $period,
      leave_type = $type,
      remark = $remark
     where id = $id`,
    {
      $date: payload.leave_date,
      $studentId: student?.id || payload.student_id || null,
      $studentName: student?.name || payload.student_name || "",
      $className: student?.class_name || payload.class_name || "",
      $period: payload.period_label || "全天",
      $type: payload.leave_type || "病假",
      $remark: payload.remark || "",
      $id: payload.id
    }
  );
  return getBootstrapData();
});

ipcMain.handle("leave:delete-record", (_event, payload) => {
  run("delete from leave_records where id = $id", { $id: payload.id });
  return getBootstrapData();
});

ipcMain.handle("leave:export-records", async (_event, payload) => {
  const className = payload?.className || "all";
  const startDate = payload?.startDate || "1900-01-01";
  const endDate = payload?.endDate || "2999-12-31";
  const type = payload?.leaveType || "all";
  const rows = all(
    `select lr.*, s.student_no
     from leave_records lr
     left join students s on s.id = lr.student_id
     where leave_date >= $start and leave_date <= $end
       and ($className = 'all' or lr.class_name = $className)
       and ($type = 'all' or lr.leave_type = $type)
     order by leave_date desc, lr.id desc`,
    { $start: startDate, $end: endDate, $className: className, $type: type }
  ).map((row) => ({
    日期: row.leave_date,
    班级: row.class_name,
    学号: row.student_no || "",
    姓名: row.student_name,
    时段: row.period_label,
    类型: row.leave_type,
    备注: row.remark || ""
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 日期: "", 姓名: "暂无请假记录" }]), "请假记录");
  const defaultPath = path.join(resolveExportsDir(), `请假记录-${startDate}_${endDate}.xlsx`);
  const result = await dialog.showSaveDialog({
    title: "导出请假记录",
    defaultPath,
    filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  XLSX.writeFile(workbook, result.filePath);
  return { canceled: false, filePath: result.filePath, count: rows.length };
});

ipcMain.handle("app:backup-database", async () => {
  const defaultPath = path.join(resolveExportsDir(), `classroom-backup-${Date.now()}.sqlite`);
  const result = await dialog.showSaveDialog({
    title: "备份教师工作台数据",
    defaultPath,
    filters: [{ name: "SQLite 数据库", extensions: ["sqlite"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.copyFileSync(dbPath, result.filePath);
  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(async () => {
  await openDatabase();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
