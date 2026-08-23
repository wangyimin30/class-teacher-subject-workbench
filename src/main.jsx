import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Bell,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Database,
  Download,
  FileText,
  FileSpreadsheet,
  FolderOpen,
  Gift,
  GraduationCap,
  History,
  Home,
  ImageDown,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  School,
  Settings,
  Shuffle,
  Timer,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  Users,
  X
} from "lucide-react";
import "./styles.css";

const days = ["周一", "周二", "周三", "周四", "周五"];
const periodCount = 11;
const periodLabels = ["早看护", "1", "2", "3", "4", "午看护", "5", "6", "7", "8", "课后服务"];
const periodTimeLabels = ["7:30-8:00", "8:25-9:05", "9:15-9:55", "10:05-10:50", "11:00-11:40", "12:20-12:50", "12:55-13:40", "13:50-14:35", "15:05-15:45", "15:55-16:35", "16:45-17:20"];
const teachingSubjectMarkColor = "var(--subject-mark-orange)";
const legacyTeachingSubjectMarkColor = "#bae6fd";
function isSubjectMarkColor(color) {
  return color === teachingSubjectMarkColor || color === legacyTeachingSubjectMarkColor || color === "var(--jp-blue-soft)";
}
function displaySubjectMarkColor(color) {
  return isSubjectMarkColor(color) ? teachingSubjectMarkColor : color;
}

const blankCell = (scope, dayIndex, periodIndex, className = "") => ({
  scope,
  class_name: scope === "class" ? className : "",
  day_index: dayIndex,
  period_index: periodIndex,
  time_label: "",
  title: "",
  teacher: "",
  location: "",
  tag: "",
  bg_color: "",
  note: ""
});

const appApi = window.workbench || createPreviewWorkbench();

function weekdayLabel(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIso() {
  return toLocalIsoDate(new Date());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseJsonSafe(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function useClickOutside(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) onOutside();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [active, onOutside]);
}

function monthIso(dateValue = todayIso()) {
  return dateValue.slice(0, 7);
}

function buildMonthDays(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = toLocalIsoDate(date);
    return {
      iso,
      day: date.getDate(),
      isCurrentMonth: iso.slice(0, 7) === monthValue,
      weekday: weekdayLabel(iso)
    };
  });
}

function dateFromIso(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function addDays(dateValue, daysToAdd) {
  const date = dateFromIso(dateValue);
  date.setDate(date.getDate() + daysToAdd);
  return toLocalIsoDate(date);
}

function mondayOfWeek(dateValue = todayIso()) {
  const date = dateFromIso(dateValue);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toLocalIsoDate(date);
}

function defaultWeekRange(dateValue = todayIso()) {
  const start = mondayOfWeek(dateValue);
  return { start, end: addDays(start, 6) };
}

function buildDateRangeDays(startValue, endValue, maxDays = 62) {
  const fallback = defaultWeekRange();
  let start = startValue || fallback.start;
  let end = endValue || fallback.end;
  if (dateFromIso(end) < dateFromIso(start)) [start, end] = [end, start];
  const daysTotal = Math.min(maxDays, Math.floor((dateFromIso(end) - dateFromIso(start)) / 86400000) + 1);
  return Array.from({ length: Math.max(1, daysTotal) }, (_, index) => {
    const iso = addDays(start, index);
    return {
      iso,
      day: Number(iso.slice(8, 10)),
      isCurrentMonth: iso.slice(0, 7) === monthIso(todayIso()),
      weekday: weekdayLabel(iso)
    };
  });
}

function buildAlignedDateRangeDays(startValue, endValue) {
  const daysInRange = buildDateRangeDays(startValue, endValue);
  const startOffset = (dateFromIso(daysInRange[0].iso).getDay() + 6) % 7;
  const endOffset = (dateFromIso(daysInRange[daysInRange.length - 1].iso).getDay() + 6) % 7;
  return [
    ...Array.from({ length: startOffset }, (_, index) => ({ iso: `blank-start-${index}`, isBlank: true })),
    ...daysInRange,
    ...Array.from({ length: 6 - endOffset }, (_, index) => ({ iso: `blank-end-${index}`, isBlank: true }))
  ];
}

function DateRangeField({ start, end, onChange, className = "" }) {
  function updateRange(next) {
    const nextStart = next.start ?? start;
    const nextEnd = next.end ?? end;
    onChange({
      start: nextStart,
      end: nextEnd && nextStart && dateFromIso(nextEnd) < dateFromIso(nextStart) ? nextStart : nextEnd
    });
  }
  return (
    <span className={`date-range-field ${className}`}>
      <input type="date" value={start || ""} onChange={(event) => updateRange({ start: event.target.value })} />
      <em>至</em>
      <input type="date" value={end || ""} onChange={(event) => updateRange({ end: event.target.value })} />
    </span>
  );
}

function QuickDetailModal({ title, subtitle, items, emptyText = "暂无相关记录。", onClose }) {
  const hasWeeklyLayout = items?.some((item) => Number.isInteger(item.dayIndex));
  const weeklyGroups = hasWeeklyLayout
    ? days.map((day, dayIndex) => ({
      day,
      items: (items || []).filter((item) => item.dayIndex === dayIndex).sort((a, b) => Number(a.periodIndex ?? 99) - Number(b.periodIndex ?? 99))
    }))
    : [];
  return createPortal(
    <div className="modal-backdrop work-area-backdrop quick-detail-backdrop" onMouseDown={onClose}>
      <section className={`detail-modal quick-detail-modal ${hasWeeklyLayout ? "weekly-detail-modal" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button type="button" onClick={onClose}><X size={15} />关闭</button>
        </div>
        {hasWeeklyLayout ? (
          <div className="quick-week-grid">
            {weeklyGroups.map((group) => (
              <section className="quick-week-column" key={group.day}>
                <header><b>{group.day}</b><span>{group.items.length} 节</span></header>
                <div>
                  {group.items.map((item, index) => (
                    <article key={`${item.title || "course"}-${index}`}>
                      <b>{periodLabels[item.periodIndex] || item.periodLabel || "课程"}节</b>
                      <span>{item.courseTitle || item.title}</span>
                      {item.meta && <em>{item.meta}</em>}
                      <small>{item.timeLabel || periodTimeLabels[item.periodIndex] || item.note}</small>
                    </article>
                  ))}
                  {!group.items.length && <p>暂无课程</p>}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="quick-detail-list">
            {items?.length ? items.map((item, index) => (
              <article key={`${item.title || "item"}-${index}`}>
                <b>{item.title}</b>
                {item.meta && <span>{item.meta}</span>}
                {item.note && <small>{item.note}</small>}
              </article>
            )) : <div className="empty-row">{emptyText}</div>}
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

const RESPONSIVE_SCALE_BASELINE_WIDTH = 1440;
const RESPONSIVE_SCALE_MIN = 0.75;
// 上限锁在 1：界面本身已经按"窗口越宽、各模块按比例分到的空间越多"设计（网格用 fr/minmax），
// 不需要再额外放大字体去填满空间；一旦超过 1 去放大字体，反而会把窗口本来就设计好的比例撑爆，
// 而且 CSS zoom 放大后 window.innerWidth 的等效值会变小，容易误触发窄屏样式、弹窗偏移这些连锁问题。
// 窗口打开时的默认尺寸就是设计基准（1440），所以只要不比默认尺寸窄，缩放始终是"刚好 1"这个最佳状态；
// 只有窗口比默认尺寸更窄时才整体等比缩小，避免挤变形。
const RESPONSIVE_SCALE_MAX = 1;

function applyResponsiveScale(prevScale) {
  // 用 CSS zoom 做整体缩放会连带改变 window.innerWidth 的度量方式（相当于把 CSS 像素也缩放了），
  // 所以每次重新计算前要先用"上一次生效的缩放值"把 innerWidth 换算回真实的物理窗口宽度，
  // 否则窗口明明没变化，缩放值也会因为测量值漂移而越缩越小或越放越大。
  if (typeof window === "undefined") return prevScale;
  const realWidth = window.innerWidth * prevScale;
  const nextScale = clamp(Number((realWidth / RESPONSIVE_SCALE_BASELINE_WIDTH).toFixed(3)), RESPONSIVE_SCALE_MIN, RESPONSIVE_SCALE_MAX);
  document.documentElement.style.zoom = String(nextScale);
  return nextScale;
}

function App() {
  const [activePage, setActivePage] = useState("home");
  const [activeWorkspace, setActiveWorkspace] = useState("classTeacher");
  const [activeTeachingPage, setActiveTeachingPage] = useState("planning");
  const [expandedGroups, setExpandedGroups] = useState({});
  const [navAllExpanded, setNavAllExpanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [teachingClass, setTeachingClass] = useState("预备5班");
  const [data, setData] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [scheduleWeek, setScheduleWeek] = useState("第1周");
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeDraft, setChangeDraft] = useState({
    change_date: "2026-08-21",
    week_label: "第1周",
    scope: "both",
    change_type: "换课",
    day_index: "0",
    period_index: "1",
    target_day_index: "",
    target_period_index: "",
    original_course: "",
    new_course: "",
    partner: "",
    reason: ""
  });
  const [planDraft, setPlanDraft] = useState({
    week_label: "第1周",
    plan_date: "2026-08-24",
    subject: "语文",
    class_name: "",
    lesson_type: "新授课",
    lesson_title: "",
    lesson_goal: "",
    resources: "",
    note: ""
  });
  const [homeworkDraft, setHomeworkDraft] = useState({
    title: "",
    subject: "语文",
    class_name: "",
    homework_type: "日常作业",
    assign_date: "2026-08-24",
    due_date: "2026-08-25",
    assigned_count: 0,
    note: ""
  });
  const [recitationDraft, setRecitationDraft] = useState({
    title: "",
    subject: "语文",
    class_name: "",
    recitation_type: "背诵",
    assign_date: "2026-08-24",
    due_date: "2026-08-25",
    content: "",
    note: ""
  });
  const [assessmentDraft, setAssessmentDraft] = useState({
    title: "",
    subject: "语文",
    class_name: "",
    test_type: "单元测评",
    test_date: "2026-08-24",
    excellent_score: 90,
    pass_score: 60,
    paper_path: "",
    note: ""
  });
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [configDraft, setConfigDraft] = useState({
    grade: "预备5班",
    termPart: "上学期",
    subject: "语文",
    teachingWeeks: 20,
    startDate: "2026-09-01",
    teacherName: "",
    teacherPhone: "",
    teacherNickname: "minmin",
    teacherAvatar: "/avatars/minmin-cat.jpg",
    theme: "blue",
    dataMode: "demo",
    teachingClasses: ["演示1班", "演示2班"],
    dataFolders: {}
  });
  const [familyDraft, setFamilyDraft] = useState({
    communication_date: todayIso(),
    student_id: "",
    contacts: [],
    student_name: "",
    contact_person: "",
    relation: "",
    channel: "微信",
    category: ["学习反馈"],
    title: "",
    content: "",
    follow_up_date: "",
    status: "待跟进",
    attachment_path: "",
    is_leave: false,
    leave_period: "全天",
    leave_type: "病假",
    leave_remark: ""
  });
  const [cooperationClass, setCooperationClass] = useState("预备5班");
  const [cooperationDraft, setCooperationDraft] = useState({
    record_date: "2026-08-24",
    class_name: "预备5班",
    group_id: "",
    student_id: "",
    type: "achievement",
    category: "课堂合作",
    points: 1,
    title: "",
    note: ""
  });
  const [todoDraft, setTodoDraft] = useState({
    todo_date: todayIso(),
    area: "班主任",
    teaching_kind: "教学",
    class_name: "",
    title: "",
    requirement: "",
    detail: "",
    credential_path: "",
    sync_work_log: true,
    sync_family: false,
    student_ids: [],
    is_leave: false,
    leave_period: "全天",
    leave_type: "病假",
    leave_remark: ""
  });
  const [leaveDraft, setLeaveDraft] = useState({
    leave_date: todayIso(),
    student_id: "",
    student_name: "",
    period_label: "全天",
    leave_type: "病假",
    remark: ""
  });

  async function reload() {
    const bootstrap = await appApi.getBootstrapData();
    setData(bootstrap);
  }

  async function updateDataFromFolders() {
    try {
      const updated = await appApi.updateDataFromFolders();
      setData(updated);
      window.alert("已重新读取系统设置中的本地数据文件夹。");
    } catch (error) {
      window.alert(`一键更新数据失败：${error?.message || error}\n\n请检查系统设置里的文件夹路径是否仍然存在。`);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useLayoutEffect(() => {
    // 全局按窗口宽度整体缩放：字体、间距、各模块比例统一跟着窗口大小放大/缩小，
    // 模块之间的相对位置关系不变（不是某一处单独调整），窗口越大整体越大，越小整体越小。
    let currentScale = 1;
    currentScale = applyResponsiveScale(currentScale);
    function handleResize() {
      currentScale = applyResponsiveScale(currentScale);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!data?.appConfig) return;
    const classes = data.appConfig.teachingClasses?.length ? data.appConfig.teachingClasses : ["演示1班", "演示2班"];
    setConfigDraft({ ...data.appConfig });
    setTeachingClass((current) => classes.includes(current) ? current : classes[0]);
    setCooperationClass((current) => classes.includes(current) ? current : classes[0]);
    setCooperationDraft((draft) => ({ ...draft, class_name: classes.includes(draft.class_name) ? draft.class_name : classes[0] }));
    setScheduleWeek((current) => current || data.appConfig.currentWeekLabel || "第1周");
    setChangeDraft((draft) => ({ ...draft, week_label: draft.week_label || data.appConfig.currentWeekLabel || "第1周" }));
    setPlanDraft((draft) => ({ ...draft, subject: data.appConfig.subject, week_label: data.appConfig.currentWeekLabel }));
    setHomeworkDraft((draft) => ({
      ...draft,
      subject: data.appConfig.subject,
      assigned_count: draft.assigned_count || data.students.length
    }));
    setRecitationDraft((draft) => ({ ...draft, subject: data.appConfig.subject }));
    setAssessmentDraft((draft) => ({ ...draft, subject: data.appConfig.subject }));
  }, [data?.appConfig?.configured, data?.appConfig?.subject, data?.appConfig?.currentWeekLabel, data?.students?.length]);

  useEffect(() => {
    // 更新到新版本后，下次启动自动弹出首次启动引导，方便检查各班级设置项
    if (data?.appConfig?.configured && data?.appConfig?.setupReviewPending) {
      setShowSetupGuide(true);
    }
  }, [data?.appConfig?.setupReviewPending]);

  const teachingClasses = data?.appConfig?.teachingClasses?.length ? data.appConfig.teachingClasses : ["演示1班", "演示2班"];
  const navItems = [
    { key: "home", icon: Home, label: "整体看板" },
    { key: "schedule-group", icon: CalendarDays, label: "课表管理", group: true },
    { key: "schedule-class", icon: null, label: "班级课程表", child: true },
    { key: "schedule-personal", icon: null, label: "任教学科课程表", child: true },
    { key: "schedule-elective", icon: null, label: "自选课名单", child: true },
    { key: "student-group", icon: Users, label: "学生管理", group: true, groupTarget: "students" },
    { key: "students", icon: null, label: "学生花名册", child: true },
    { key: "cooperation", icon: null, label: "小组合作", child: true },
    { key: "seating", icon: null, label: "班级座位表", child: true },
    { key: "family-group", icon: MessageSquare, label: "家校沟通", group: true, groupTarget: "family" },
    { key: "family", icon: null, label: "沟通记录", child: true },
    { key: "leave", icon: null, label: "请假管理", child: true },
    { key: "family-collaboration", icon: null, label: "家校协同", child: true },
    { key: "family-pending", icon: null, label: "未完成事项", child: true },
    { key: "logs", icon: ListChecks, label: "工作留痕" },
    { key: "tools", icon: Gift, label: "活动工具" },
    { key: "settings", icon: Settings, label: "系统设置" }
  ];

  const teachingNavItems = [
    { key: "home", icon: Home, label: "整体看板" },
    { key: "planning", icon: CalendarDays, label: "教学规划" },
    { key: "homework", icon: ClipboardList, label: "作业管理", group: true },
    ...teachingClasses.map((className) => ({ key: `homework-${className}`, icon: null, label: className, child: true, className })),
    { key: "recitation", icon: BookOpenCheck, label: "背默管理", group: true },
    ...teachingClasses.map((className) => ({ key: `recitation-${className}`, icon: null, label: className, child: true, className })),
    { key: "assessment", icon: Trophy, label: "测评管理", group: true },
    ...teachingClasses.map((className) => ({ key: `assessment-${className}`, icon: null, label: className, child: true, className })),
    { key: "settings", icon: Settings, label: "系统设置" }
  ];

  if (!data) {
    return (
      <div className="loading-screen">
        <Database />
        <span>正在读取本地数据库...</span>
      </div>
    );
  }

  async function saveCell(cell) {
    const updated = await appApi.saveScheduleCell(cell);
    setData(updated);
    setSelectedCell(null);
  }

  async function applyScheduleSubjectColor(payload) {
    const updated = await appApi.applyScheduleSubjectColor(payload);
    setData(updated);
  }

  async function addChange(event) {
    event.preventDefault();
    if (!changeDraft.original_course || !changeDraft.new_course) return;
    const payload = {
      ...changeDraft,
      target_day_index: changeDraft.target_day_index === "" || changeDraft.target_day_index == null ? changeDraft.day_index : changeDraft.target_day_index,
      target_period_index: changeDraft.target_period_index === "" || changeDraft.target_period_index == null ? changeDraft.period_index : changeDraft.target_period_index
    };
    const updated = await appApi.addScheduleChange(payload);
    setData(updated);
    setScheduleWeek(payload.week_label || data.appConfig.currentWeekLabel || "第1周");
    setShowChangeModal(false);
    setChangeDraft((draft) => ({ ...draft, original_course: "", new_course: "", partner: "", reason: "", target_day_index: "", target_period_index: "" }));
  }

  async function backup() {
    await appApi.backupDatabase();
  }

  async function addPlan(event) {
    event.preventDefault();
    if (!planDraft.lesson_title.trim()) return;
    const updated = await appApi.addSubjectPlan({
      ...planDraft
    });
    setData(updated);
    setPlanDraft((draft) => ({ ...draft, lesson_type: "新授课", lesson_title: "", lesson_goal: "", resources: "", note: "" }));
  }

  async function togglePlan(plan) {
    const updated = await appApi.toggleSubjectPlan({ id: plan.id, is_done: plan.is_done ? 0 : 1 });
    setData(updated);
  }

  async function addHomework(event) {
    event.preventDefault();
    if (!homeworkDraft.title.trim()) return;
    const targetCount = homeworkDraft.class_name
      ? data.students.filter((student) => student.class_name === homeworkDraft.class_name).length
      : data.appConfig.teachingClasses.reduce((sum, className) => sum + data.students.filter((student) => student.class_name === className).length, 0);
    const updated = await appApi.addHomeworkTask({
      ...homeworkDraft,
      assigned_count: Number(homeworkDraft.assigned_count || targetCount || data.students.length)
    });
    setData(updated);
    setHomeworkDraft((draft) => ({ ...draft, class_name: "", homework_type: "日常作业", title: "", note: "", assigned_count: data.students.length }));
  }

  async function addHomeworkPayload(payload) {
    if (!payload.title?.trim()) return;
    const targetCount = payload.class_name
      ? data.students.filter((student) => student.class_name === payload.class_name).length
      : data.appConfig.teachingClasses.reduce((sum, className) => sum + data.students.filter((student) => student.class_name === className).length, 0);
    const updated = await appApi.addHomeworkTask({
      ...payload,
      assigned_count: Number(payload.assigned_count || targetCount || data.students.length)
    });
    setData(updated);
  }

  async function addPlanningBundle(event, extras) {
    event.preventDefault();
    if (!planDraft.lesson_title.trim()) return;
    let updated = await appApi.addSubjectPlan({ ...planDraft });
    if (planDraft.lesson_type === "学科测试") {
      updated = await appApi.addAssessment({
        title: planDraft.lesson_title,
        subject: planDraft.subject,
        class_name: planDraft.class_name || "",
        test_type: "学科测试",
        test_date: planDraft.plan_date,
        excellent_score: 90,
        pass_score: 60,
        paper_path: planDraft.resources || "",
        note: [planDraft.lesson_goal, planDraft.note].filter(Boolean).join("；")
      });
    }
    if (extras?.homework?.title?.trim()) {
      updated = await appApi.addHomeworkTask({
        ...extras.homework,
        subject: planDraft.subject,
        class_name: planDraft.class_name || "",
        assign_date: planDraft.plan_date,
        due_date: extras.homework.due_date || planDraft.plan_date,
        assigned_count: data.students.length
      });
    }
    if (extras?.recitation?.title?.trim()) {
      updated = await appApi.addRecitationTask({
        ...extras.recitation,
        subject: planDraft.subject,
        class_name: planDraft.class_name || "",
        assign_date: planDraft.plan_date,
        due_date: extras.recitation.due_date || planDraft.plan_date
      });
    }
    setData(updated);
    setPlanDraft((draft) => ({ ...draft, lesson_type: "新授课", lesson_title: "", lesson_goal: "", resources: "", note: "" }));
  }

  async function updateHomework(task, changes) {
    const updated = await appApi.updateHomeworkTask({ ...task, ...changes });
    setData(updated);
  }

  async function updateSubjectPlan(plan, changes) {
    const updated = await appApi.updateSubjectPlan({ ...plan, ...changes });
    setData(updated);
  }

  async function deleteSubjectPlan(plan) {
    const updated = await appApi.deleteSubjectPlan({ id: plan.id });
    setData(updated);
  }

  async function deleteHomework(task) {
    const updated = await appApi.deleteHomeworkTask({ id: task.id });
    setData(updated);
  }

  async function addRecitation(event) {
    event.preventDefault();
    if (!recitationDraft.title.trim()) return;
    const updated = await appApi.addRecitationTask(recitationDraft);
    setData(updated);
    setRecitationDraft((draft) => ({ ...draft, title: "", content: "", note: "" }));
  }

  async function addRecitationPayload(payload) {
    if (!payload.title?.trim()) return;
    const updated = await appApi.addRecitationTask(payload);
    setData(updated);
  }

  async function updateRecitation(task, changes) {
    const updated = await appApi.updateRecitationTask({ ...task, ...changes });
    setData(updated);
  }

  async function deleteRecitation(task) {
    const updated = await appApi.deleteRecitationTask({ id: task.id });
    setData(updated);
  }

  async function addAssessment(event, payload = assessmentDraft) {
    event?.preventDefault();
    if (!payload.title?.trim()) return;
    const updated = await appApi.addAssessment({
      ...payload,
      subject: payload.subject || data.appConfig.subject || "语文"
    });
    setData(updated);
    setAssessmentDraft((draft) => ({ ...draft, title: "", class_name: "", paper_path: "", note: "" }));
    return updated;
  }

  async function updateAssessment(payload) {
    const updated = await appApi.updateAssessment(payload);
    setData(updated);
    return updated;
  }

  async function deleteAssessment(payload) {
    const updated = await appApi.deleteAssessment(payload);
    setData(updated);
    return updated;
  }

  async function setAssessmentScore(payload) {
    const updated = await appApi.setAssessmentScore(payload);
    setData(updated);
    return updated;
  }

  async function setTaskStudentStatus(payload) {
    const updated = await appApi.setTaskStudentStatus(payload);
    setData(updated);
  }

  async function updateStudentRemark(student, remark) {
    const updated = await appApi.updateStudentRemark({ id: student.id, remark });
    setData(updated);
  }

  async function updateStudentProfile(payload) {
    const updated = await appApi.updateStudentProfile(payload);
    setData(updated);
  }

  async function updateStudentRoles(student, roles) {
    try {
      const updated = await appApi.updateStudentRoles({ id: student.id, roles });
      setData(updated);
    } catch (error) {
      window.alert(`班干部信息保存失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function assignSeat(payload) {
    const updated = await appApi.assignSeat(payload);
    setData(updated);
  }

  async function resetSeating(payload) {
    try {
      const updated = await appApi.resetSeating(payload);
      setData(updated);
    } catch (error) {
      window.alert(`一键重置座位失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function randomizeSeating(payload) {
    try {
      const updated = await appApi.randomizeSeating(payload);
      setData(updated);
    } catch (error) {
      window.alert(`随机安排座位失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function rotateSeatingColumns(payload) {
    try {
      const updated = await appApi.rotateSeatingColumns(payload);
      setData(updated);
    } catch (error) {
      window.alert(`每周换座位失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function saveSeatingSnapshot(payload) {
    try {
      const updated = await appApi.saveSeatingSnapshot(payload);
      setData(updated);
    } catch (error) {
      window.alert(`保存座位版本失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function applySeatingSnapshot(payload) {
    try {
      const updated = await appApi.applySeatingSnapshot(payload);
      setData(updated);
    } catch (error) {
      window.alert(`应用历史座位版本失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function saveConfig(event) {
    event.preventDefault();
    // 设置页不再单独填"本学期年级"：班主任班级优先取勾选了"担任班主任"的那个班，其次取任教班级列表里的第一个
    const profiles = configDraft.classProfiles || {};
    const homeroomClass = Object.entries(profiles).find(([, profile]) => profile?.isHomeroom)?.[0];
    const firstClass = configDraft.teachingClasses?.find((item) => item && item.trim());
    const grade = (homeroomClass && configDraft.teachingClasses?.includes(homeroomClass)) ? homeroomClass : firstClass;
    // 每个班级卡片里上传的名单/信息表，合并进统一的学生名单文件夹列表，这样原有的名单导入逻辑不用改
    const mergedRoster = Array.from(new Set([
      ...normalizeFolderList(configDraft.dataFolders?.roster),
      ...Object.values(profiles).flatMap((profile) => normalizeFolderList(profile?.rosterFolders))
    ]));
    const payload = {
      ...configDraft,
      ...(grade ? { grade } : {}),
      dataFolders: { ...(configDraft.dataFolders || {}), roster: mergedRoster }
    };
    try {
      const updated = await appApi.saveAppConfig(payload);
      setData(updated);
      setPlanDraft((draft) => ({ ...draft, subject: updated.appConfig.subject, week_label: updated.appConfig.currentWeekLabel }));
      setHomeworkDraft((draft) => ({ ...draft, subject: updated.appConfig.subject, assigned_count: updated.students.length }));
      setRecitationDraft((draft) => ({ ...draft, subject: updated.appConfig.subject }));
    } catch (error) {
      window.alert(`保存设置失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function dismissSetupReview() {
    setShowSetupGuide(false);
    if (data?.appConfig?.setupReviewPending) {
      const updated = await appApi.ackSetupReview();
      setData(updated);
    }
  }

  async function addFamilyCommunication(event) {
    event.preventDefault();
    if (!familyDraft.title.trim()) return;
    const contacts = (familyDraft.contacts && familyDraft.contacts.length) ? familyDraft.contacts : [null];
    try {
      let updated = data;
      for (const entry of contacts) {
        const student = entry ? data.students.find((item) => String(item.id) === String(entry.student_id)) : null;
        const contactName = entry?.relation === "爸爸" ? (student?.father_name || "爸爸") : entry?.relation === "妈妈" ? (student?.mother_name || "妈妈") : (student?.guardian || "");
        updated = await appApi.addFamilyCommunication({
          ...familyDraft,
          student_id: student?.id || null,
          student_name: student?.name || "",
          contact_person: contactName,
          relation: entry?.relation || student?.guardian_relation || ""
        });
      }
      setData(updated);
      setFamilyDraft((draft) => ({
        ...draft,
        contacts: [],
        student_id: "",
        student_name: "",
        contact_person: "",
        relation: "",
        title: "",
        content: "",
        attachment_path: "",
        is_leave: false,
        leave_period: "全天",
        leave_type: "病假",
        leave_remark: ""
      }));
    } catch (error) {
      window.alert(`保存家校沟通记录失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function updateFamilyCommunication(record) {
    try {
      const updated = await appApi.updateFamilyCommunication(record);
      setData(updated);
    } catch (error) {
      window.alert(`更新家校沟通记录失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function deleteFamilyCommunication(id) {
    try {
      const updated = await appApi.deleteFamilyCommunication({ id });
      setData(updated);
    } catch (error) {
      window.alert(`删除家校沟通记录失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function addFamilyCommittee(event, payload) {
    event.preventDefault();
    if (!payload.student_name.trim() && !payload.parent_name.trim()) return;
    const updated = await appApi.addFamilyCommittee(payload);
    setData(updated);
  }

  async function updateFamilyCommittee(payload) {
    const updated = await appApi.updateFamilyCommittee(payload);
    setData(updated);
  }

  async function addFamilyActivity(event, payload) {
    event.preventDefault();
    if (!payload.title.trim()) return;
    const updated = await appApi.addFamilyActivity(payload);
    setData(updated);
  }

  async function updateFamilyActivity(payload) {
    const updated = await appApi.updateFamilyActivity(payload);
    setData(updated);
  }

  async function addClassTodo(event, overrideDraft = null) {
    event?.preventDefault();
    const draftPayload = overrideDraft || todoDraft;
    if (!draftPayload.title.trim()) return;
    let updated = null;
    if (draftPayload.area === "教学") {
      const className = draftPayload.class_name || "";
      const targetCount = className
        ? data.students.filter((student) => student.class_name === className).length
        : data.appConfig.teachingClasses.reduce((sum, item) => sum + data.students.filter((student) => student.class_name === item).length, 0);
      if (draftPayload.teaching_kind === "作业") {
        updated = await appApi.addHomeworkTask({
          title: draftPayload.title,
          subject: data.appConfig.subject,
          class_name: className,
          homework_type: "日常作业",
          assign_date: draftPayload.todo_date,
          due_date: draftPayload.todo_date,
          assigned_count: targetCount || data.students.length,
          note: [draftPayload.requirement, draftPayload.detail].filter(Boolean).join("；")
        });
      } else if (draftPayload.teaching_kind === "背默") {
        updated = await appApi.addRecitationTask({
          title: draftPayload.title,
          subject: data.appConfig.subject,
          class_name: className,
          recitation_type: "背诵",
          assign_date: draftPayload.todo_date,
          due_date: draftPayload.todo_date,
          content: draftPayload.requirement,
          note: draftPayload.detail
        });
      } else if (draftPayload.teaching_kind === "测评") {
        updated = await appApi.addAssessment({
          title: draftPayload.title,
          subject: data.appConfig.subject,
          class_name: className,
          test_type: "学科测试",
          test_date: draftPayload.todo_date,
          excellent_score: 90,
          pass_score: 60,
          note: [draftPayload.requirement, draftPayload.detail].filter(Boolean).join("；")
        });
      } else {
        updated = await appApi.addSubjectPlan({
          plan_date: draftPayload.todo_date,
          week_label: data.appConfig.currentWeekLabel,
          subject: data.appConfig.subject,
          class_name: className,
          lesson_type: "新授课",
          lesson_title: draftPayload.title,
          lesson_goal: draftPayload.requirement,
          resources: draftPayload.credential_path || "",
          note: draftPayload.detail
        });
      }
    } else {
      updated = await appApi.addClassTodo(draftPayload);
    }
    setData(updated);
    setTodoDraft((draft) => ({
      ...draft,
      area: "班主任",
      teaching_kind: "教学",
      class_name: "",
      title: "",
      requirement: "",
      detail: "",
      credential_path: "",
      sync_work_log: true,
      sync_family: false,
      student_ids: [],
      is_leave: false,
      leave_period: "全天",
      leave_type: "病假",
      leave_remark: ""
    }));
  }

  async function updateClassTodo(payload) {
    const updated = await appApi.updateClassTodo(payload);
    setData(updated);
    return updated;
  }

  async function deleteClassTodo(payload) {
    const updated = await appApi.deleteClassTodo(payload);
    setData(updated);
    return updated;
  }

  async function addLeaveRecord(event) {
    event.preventDefault();
    if (!leaveDraft.student_id && !leaveDraft.student_name?.trim()) return;
    const updated = await appApi.addLeaveRecord(leaveDraft);
    setData(updated);
    setLeaveDraft((draft) => ({ ...draft, student_id: "", student_name: "", remark: "" }));
  }

  async function updateLeaveRecord(record) {
    const updated = await appApi.updateLeaveRecord(record);
    setData(updated);
  }

  async function deleteLeaveRecord(record) {
    const updated = await appApi.deleteLeaveRecord({ id: record.id });
    setData(updated);
  }

  async function addWorkLog(payload) {
    try {
      const updated = await appApi.addWorkLog(payload);
      setData(updated);
    } catch (error) {
      window.alert(`新增工作留痕失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function updateWorkLog(payload) {
    try {
      const updated = await appApi.updateWorkLog(payload);
      setData(updated);
    } catch (error) {
      window.alert(`修改工作留痕失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function deleteWorkLog(payload) {
    try {
      const updated = await appApi.deleteWorkLog(payload);
      setData(updated);
    } catch (error) {
      window.alert(`删除工作留痕失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
      throw error;
    }
  }

  async function addCooperationRecord(event) {
    event.preventDefault();
    if (!cooperationDraft.title.trim()) return;
    const updated = await appApi.addCooperationRecord({
      ...cooperationDraft,
      class_name: cooperationClass
    });
    setData(updated);
    setCooperationDraft((draft) => ({ ...draft, title: "", note: "" }));
  }

  async function updateCooperationGroup(payload) {
    const updated = await appApi.updateCooperationGroup(payload);
    setData(updated);
  }

  async function addCooperationGroup(payload) {
    const updated = await appApi.addCooperationGroup(payload);
    setData(updated);
    return updated;
  }

  async function setCooperationMembers(payload) {
    const result = await appApi.setCooperationMembers(payload);
    if (result?.ok === false) return result;
    setData(result?.data || result);
    return { ok: true };
  }

  async function addCooperationProject(event, payload) {
    event.preventDefault();
    if (!payload.project_name.trim()) return;
    const updated = await appApi.addCooperationProject(payload);
    setData(updated);
  }

  async function updateCooperationProject(payload) {
    const updated = await appApi.updateCooperationProject(payload);
    setData(updated);
  }

  async function deleteCooperationProject(payload) {
    const updated = await appApi.deleteCooperationProject(payload);
    setData(updated);
  }

  function groupNavItems(items) {
    const groups = [];
    let currentGroup = null;
    for (const item of items) {
      if (item.group) {
        currentGroup = { group: { ...item, children: [] }, children: [] };
        groups.push(currentGroup);
      } else if (item.child && currentGroup) {
        const childItem = { ...item };
        currentGroup.children.push(childItem);
        currentGroup.group.children.push(childItem);
      } else {
        groups.push({ item });
        currentGroup = null;
      }
    }
    return groups;
  }

  function isGroupActive(groupItem) {
    if (activeWorkspace === "teaching") {
      return activeTeachingPage === groupItem.key || activeTeachingPage?.startsWith(`${groupItem.key}-`);
    }
    return activePage === groupItem.groupTarget || activePage === groupItem.key || groupItem.children.some((child) => child.key === activePage);
  }

  function isGroupExpanded(groupItem) {
    // 二三级标签只在点击了对应一级标签之后才展开，不再因为“当前正好停在这个分组下的页面”而自动展开，
    // 避免导航栏因为常驻展开一个较长的分组而超出窗口高度。
    return navAllExpanded || !!expandedGroups[groupItem.key];
  }

  function handleGroupClick(groupItem) {
    if (!navAllExpanded) {
      setExpandedGroups((prev) => ({ ...prev, [groupItem.key]: !prev[groupItem.key] }));
    }
    if (activeWorkspace === "teaching") {
      setActiveTeachingPage(groupItem.key);
    } else {
      setActivePage(groupItem.groupTarget || groupItem.key);
    }
  }

  return (
    <div className={`app-shell ${(configDraft.theme || data?.appConfig?.theme) === "green" ? "theme-green" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {!window.workbench && (
        <div className="preview-banner">
          当前是浏览器演示预览：可以点击体验，数据只临时保存在本浏览器。正式保存到本地数据库请打开桌面应用。
        </div>
      )}
      <aside className="sidebar">
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          title={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
        >
          <ChevronRight size={16} />
        </button>
        <div className="brand-block">
          {data.appConfig?.teacherAvatar && <img src={data.appConfig.teacherAvatar} alt="" />}
          <div>
            <span>{[data.appConfig?.teacherNickname, data.scheduleMeta.className].filter(Boolean).join(" · ")}</span>
            <strong>教师工作台</strong>
          </div>
        </div>
        <div className="workspace-tabs sidebar-workspace-tabs">
          <button className={activeWorkspace === "classTeacher" ? "is-active" : ""} type="button" onClick={() => setActiveWorkspace("classTeacher")}>班主任工作台</button>
          <button className={activeWorkspace === "teaching" ? "is-active teaching-tab" : "teaching-tab"} type="button" onClick={() => setActiveWorkspace("teaching")}>{data.appConfig?.subject || "学科"}教学工作台</button>
        </div>
        <nav className="nav-list">
          <button
            className={`nav-expand-toggle ${navAllExpanded ? "is-active" : ""}`}
            type="button"
            onClick={() => setNavAllExpanded((value) => !value)}
          >
            {navAllExpanded ? "收起目录" : "全部展开"}
          </button>
          {/* 当前工作台的可折叠分组导航 */}
          {groupNavItems(activeWorkspace === "teaching" ? teachingNavItems : navItems).map((entry) => {
            if (entry.item) {
              const item = entry.item;
              const Icon = item.icon;
              const isActive = activeWorkspace === "teaching"
                ? activeTeachingPage === item.key
                : activePage === item.key;
              return (
                <button
                  className={`nav-button ${isActive ? "is-active" : ""}`}
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (activeWorkspace === "teaching") setActiveTeachingPage(item.key);
                    else setActivePage(item.key);
                  }}
                >
                  {Icon ? <Icon size={19} /> : <span className="nav-child-dot" />}
                  <span>{item.label}</span>
                </button>
              );
            }

            const groupItem = entry.group;
            const Icon = groupItem.icon;
            const expanded = isGroupExpanded(groupItem);
            const active = isGroupActive(groupItem);
            return (
              <React.Fragment key={groupItem.key}>
                <button
                  className={`nav-button nav-group ${active ? "is-active" : ""}`}
                  type="button"
                  onClick={() => handleGroupClick(groupItem)}
                >
                  {Icon ? <Icon size={19} /> : <span className="nav-child-dot" />}
                  <span>{groupItem.label}</span>
                  <ChevronDown size={16} className={`nav-chevron ${expanded ? "is-open" : ""}`} />
                </button>
                <div className={`nav-children ${expanded ? "is-open" : ""}`}>
                  {groupItem.children.map((child) => {
                    const ChildIcon = child.icon;
                    const isChildActive = activeWorkspace === "teaching"
                      ? activeTeachingPage === child.key
                      : activePage === child.key;
                    return (
                      <button
                        className={`nav-button nav-child ${isChildActive ? "is-active" : ""}`}
                        key={child.key}
                        type="button"
                        onClick={() => {
                          if (activeWorkspace === "teaching") {
                            setActiveTeachingPage(child.key);
                            if (child.className) setTeachingClass(child.className);
                          } else {
                            setActivePage(child.key);
                          }
                        }}
                      >
                        {ChildIcon ? <ChildIcon size={16} /> : <span className="nav-child-dot" />}
                        <span>{child.label}</span>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="db-note">
          <Database size={18} />
          <b>本地 SQLite 数据库</b>
          <span>{data.appInfo.dbPath}</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="app-topbar">
          <div className="topbar-title-block">
            <h1>{
              activeWorkspace === "teaching" && activeTeachingPage === "home" ? "整体看板"
              : activeWorkspace === "teaching" && activeTeachingPage === "settings" ? "系统设置"
              : activeWorkspace === "teaching" ? `${data.appConfig?.subject || "学科"}教学工作台`
              : activePage === "home" ? "整体看板"
              : activePage?.startsWith("schedule") ? "课表管理"
              : activePage === "family" || activePage === "leave" || activePage?.startsWith("family-") ? "家校沟通"
              : activePage === "students" ? "学生管理"
              : activePage === "cooperation" ? "小组合作"
              : activePage === "seating" ? "班级座位表"
              : activePage === "logs" ? "工作留痕"
              : activePage === "tools" ? "活动工具"
              : activePage === "settings" ? "系统设置"
              : "整体看板"
            }</h1>
            <p>{data.scheduleMeta.className} · {data.scheduleMeta.term} · {data.appConfig.currentWeekLabel} · 执教学科：{data.appConfig.subject}</p>
          </div>
          <div className="top-actions">
            <button type="button" onClick={reload}><RefreshCcw size={16} />刷新</button>
            <button type="button" onClick={backup}><Download size={16} />备份数据</button>
          </div>
        </header>

        {activeWorkspace === "teaching" && activeTeachingPage === "home" && (
          <HomePage
            data={data}
            setActivePage={(target) => { setActiveWorkspace("classTeacher"); setActivePage(target); }}
            setActiveWorkspace={setActiveWorkspace}
            todoDraft={todoDraft}
            setTodoDraft={setTodoDraft}
            addClassTodo={addClassTodo}
            updateClassTodo={updateClassTodo}
            deleteClassTodo={deleteClassTodo}
            updateSubjectPlan={updateSubjectPlan}
            deleteSubjectPlan={deleteSubjectPlan}
            updateHomework={updateHomework}
            deleteHomework={deleteHomework}
            updateRecitation={updateRecitation}
            deleteRecitation={deleteRecitation}
            updateAssessment={updateAssessment}
            deleteAssessment={deleteAssessment}
          />
        )}
        {activeWorkspace === "teaching" && activeTeachingPage === "settings" && (
          <SystemSettingsPage
            data={data}
            draft={configDraft}
            setDraft={setConfigDraft}
            onSave={saveConfig}
            onReload={updateDataFromFolders}
            onBackup={backup}
            onShowSetupGuide={() => setShowSetupGuide(true)}
          />
        )}
        {activeWorkspace === "teaching" && activeTeachingPage !== "home" && activeTeachingPage !== "settings" && (
          <SubjectPage
            data={data}
            teachingClass={teachingClass}
            setTeachingClass={setTeachingClass}
            planDraft={planDraft}
            setPlanDraft={setPlanDraft}
            homeworkDraft={homeworkDraft}
            setHomeworkDraft={setHomeworkDraft}
            addPlan={addPlan}
            togglePlan={togglePlan}
            addHomework={addHomework}
            addHomeworkPayload={addHomeworkPayload}
            updateHomework={updateHomework}
            updateSubjectPlan={updateSubjectPlan}
            deleteSubjectPlan={deleteSubjectPlan}
            deleteHomework={deleteHomework}
            addPlanningBundle={addPlanningBundle}
            activeTeachingPage={activeTeachingPage}
            setActiveTeachingPage={setActiveTeachingPage}
            recitationDraft={recitationDraft}
            setRecitationDraft={setRecitationDraft}
            assessmentDraft={assessmentDraft}
            setAssessmentDraft={setAssessmentDraft}
            addRecitation={addRecitation}
            addRecitationPayload={addRecitationPayload}
            updateRecitation={updateRecitation}
            deleteRecitation={deleteRecitation}
            addAssessment={addAssessment}
            updateAssessment={updateAssessment}
            deleteAssessment={deleteAssessment}
            setAssessmentScore={setAssessmentScore}
            setTaskStudentStatus={setTaskStudentStatus}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "home" && (
          <HomePage
            data={data}
            setActivePage={setActivePage}
            setActiveWorkspace={setActiveWorkspace}
            todoDraft={todoDraft}
            setTodoDraft={setTodoDraft}
            addClassTodo={addClassTodo}
            updateClassTodo={updateClassTodo}
            deleteClassTodo={deleteClassTodo}
            updateSubjectPlan={updateSubjectPlan}
            deleteSubjectPlan={deleteSubjectPlan}
            updateHomework={updateHomework}
            deleteHomework={deleteHomework}
            updateRecitation={updateRecitation}
            deleteRecitation={deleteRecitation}
            updateAssessment={updateAssessment}
            deleteAssessment={deleteAssessment}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "family" && (
          <FamilyCommunicationPage
            data={data}
            familyDraft={familyDraft}
            setFamilyDraft={setFamilyDraft}
            addFamilyCommunication={addFamilyCommunication}
            updateFamilyCommunication={updateFamilyCommunication}
            deleteFamilyCommunication={deleteFamilyCommunication}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "family-collaboration" && (
          <FamilyCollaborationPage
            data={data}
            addFamilyCommittee={addFamilyCommittee}
            updateFamilyCommittee={updateFamilyCommittee}
            addFamilyActivity={addFamilyActivity}
            updateFamilyActivity={updateFamilyActivity}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "family-pending" && (
          <FamilyPendingPage data={data} updateFamilyCommunication={updateFamilyCommunication} />
        )}
        {activeWorkspace === "classTeacher" && activePage === "students" && <StudentsPage data={data} updateStudentRemark={updateStudentRemark} updateStudentRoles={updateStudentRoles} />}
        {activeWorkspace === "classTeacher" && activePage === "seating" && (
          <SeatingPage
            data={data}
            assignSeat={assignSeat}
            updateStudentProfile={updateStudentProfile}
            randomizeSeating={randomizeSeating}
            rotateSeatingColumns={rotateSeatingColumns}
            saveSeatingSnapshot={saveSeatingSnapshot}
            applySeatingSnapshot={applySeatingSnapshot}
            resetSeating={resetSeating}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "cooperation" && (
          <CooperationPage
            data={data}
            selectedClass={cooperationClass}
            setSelectedClass={setCooperationClass}
            draft={cooperationDraft}
            setDraft={setCooperationDraft}
            addRecord={addCooperationRecord}
            addGroup={addCooperationGroup}
            updateGroup={updateCooperationGroup}
            setMembers={setCooperationMembers}
            addProject={addCooperationProject}
            updateProject={updateCooperationProject}
            deleteProject={deleteCooperationProject}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "schedule-group" && (
          <ScheduleOverviewPage
            data={data}
            scheduleWeek={scheduleWeek}
            setScheduleWeek={setScheduleWeek}
            changeDraft={changeDraft}
            setChangeDraft={setChangeDraft}
            setActivePage={setActivePage}
            setShowChangeModal={setShowChangeModal}
          />
        )}
        {activeWorkspace === "classTeacher" && ["schedule-class", "schedule-personal"].includes(activePage) && (
          <SchedulePage
            data={data}
            mode={activePage === "schedule-personal" ? "personal" : "class"}
            scheduleWeek={scheduleWeek}
            setScheduleWeek={setScheduleWeek}
            selectedCell={selectedCell}
            setSelectedCell={setSelectedCell}
            saveCell={saveCell}
            changeDraft={changeDraft}
            setChangeDraft={setChangeDraft}
            addChange={addChange}
            showChangeModal={showChangeModal}
            setShowChangeModal={setShowChangeModal}
            reload={reload}
            applyScheduleSubjectColor={applyScheduleSubjectColor}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "schedule-elective" && <ElectiveSchedulePage data={data} reload={reload} />}
        {activeWorkspace === "classTeacher" && activePage === "logs" && <WorkLogsPage data={data} addWorkLog={addWorkLog} updateWorkLog={updateWorkLog} deleteWorkLog={deleteWorkLog} />}
        {activeWorkspace === "classTeacher" && activePage === "tools" && <ActivityToolsPage data={data} />}
        {activeWorkspace === "classTeacher" && activePage === "settings" && (
          <SystemSettingsPage
            data={data}
            draft={configDraft}
            setDraft={setConfigDraft}
            onSave={saveConfig}
            onReload={updateDataFromFolders}
            onBackup={backup}
            onShowSetupGuide={() => setShowSetupGuide(true)}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "leave" && (
          <LeavePage
            data={data}
            draft={leaveDraft}
            setDraft={setLeaveDraft}
            addLeaveRecord={addLeaveRecord}
            updateLeaveRecord={updateLeaveRecord}
            deleteLeaveRecord={deleteLeaveRecord}
          />
        )}
        {activeWorkspace === "classTeacher" && activePage === "schedule-group" && showChangeModal && (
          <ChangeEditor
            draft={changeDraft}
            setDraft={setChangeDraft}
            weekOptions={buildWeekOptions(data)}
            onClose={() => setShowChangeModal(false)}
            onSubmit={addChange}
          />
        )}
        {activeWorkspace === "classTeacher" && !["home", "schedule-group", "schedule-class", "schedule-personal", "schedule-elective", "family", "family-collaboration", "family-pending", "students", "cooperation", "logs", "leave", "tools", "settings", "seating"].includes(activePage) && <ComingSoon page={navItems.find((item) => item.key === activePage)?.label} />}
      </main>

      {!data.appConfig.configured && <SetupModal draft={configDraft} setDraft={setConfigDraft} onSubmit={saveConfig} />}
      {data.appConfig.configured && showSetupGuide && (
        <SetupModal
          draft={configDraft}
          setDraft={setConfigDraft}
          onSubmit={async (event) => {
            await saveConfig(event);
            setShowSetupGuide(false);
          }}
          onClose={dismissSetupReview}
          reviewReminder={data.appConfig.setupReviewPending}
        />
      )}
    </div>
  );
}

function TeacherIdentityFields({ draft, setDraft }) {
  function handleAvatarFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft({ ...draft, teacherAvatar: String(reader.result || "") });
    reader.readAsDataURL(file);
  }
  return (
    <section className="setup-identity-panel">
      <div>
        <h3>昵称与头像</h3>
        <span>会显示在左侧导航栏顶部，每个人都可以改成自己喜欢的样子</span>
      </div>
      <div className="setup-identity-row">
        <div className="setup-avatar-preview">
          {draft.teacherAvatar ? <img src={draft.teacherAvatar} alt="" /> : <span>无</span>}
        </div>
        <div className="setup-identity-inputs">
          <label>昵称<input value={draft.teacherNickname || ""} onChange={(event) => setDraft({ ...draft, teacherNickname: event.target.value })} placeholder="如：minmin" /></label>
          <div className="setup-avatar-actions">
            <label className="attach-button">{draft.teacherAvatar ? "更换头像" : "上传头像（可不选）"}
              <input type="file" accept="image/*" onChange={handleAvatarFile} />
            </label>
            {draft.teacherAvatar && <button type="button" className="subtle-button" onClick={() => setDraft({ ...draft, teacherAvatar: "" })}>清除头像</button>}
          </div>
        </div>
      </div>
    </section>
  );
}

function normalizeFolderList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

async function pickAndAddFolder(draft, setDraft, key) {
  if (!appApi.chooseFolder) return;
  const picked = await appApi.chooseFolder();
  const list = Array.isArray(picked) ? picked.filter(Boolean) : picked ? [picked] : [];
  if (!list.length) return;
  const current = normalizeFolderList((draft.dataFolders || {})[key]);
  const next = Array.from(new Set([...current, ...list]));
  setDraft({ ...draft, dataFolders: { ...(draft.dataFolders || {}), [key]: next } });
}

function addManualFolder(draft, setDraft, key, value) {
  const trimmed = String(value || "").trim();
  const current = normalizeFolderList((draft.dataFolders || {})[key]);
  if (!trimmed || current.includes(trimmed)) return;
  setDraft({ ...draft, dataFolders: { ...(draft.dataFolders || {}), [key]: [...current, trimmed] } });
}

function removeFolderAt(draft, setDraft, key, index) {
  const current = normalizeFolderList((draft.dataFolders || {})[key]);
  setDraft({ ...draft, dataFolders: { ...(draft.dataFolders || {}), [key]: current.filter((_, i) => i !== index) } });
}

function FolderMultiField({ label, values, onAdd, onRemove, onManualAdd }) {
  const [manualValue, setManualValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  function submitManual() {
    if (!manualValue.trim()) return;
    onManualAdd(manualValue.trim());
    setManualValue("");
  }
  return (
    <div className="folder-multi-field">
      <div className="folder-multi-head">
        <span>{label}</span>
        {values.length > 0 && (
          <button type="button" className="folder-multi-toggle" onClick={() => setExpanded((value) => !value)}>
            已添加{values.length}项{expanded ? "，收起" : "，展开"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="folder-multi-list">
          {values.map((path, index) => (
            <div className="folder-multi-item" key={`${path}-${index}`}>
              <span title={path}>{path}</span>
              <button type="button" onClick={() => onRemove(index)}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="folder-multi-manual" onClick={onAdd} title="点击直接打开系统文件选择器，也可以在输入框里手动粘贴路径">
        <FolderOpen size={14} />
        <input
          value={manualValue}
          onChange={(event) => setManualValue(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          placeholder="点击选择文件夹/文件，或手动粘贴路径后回车添加（可留空，先用演示数据）"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitManual();
            }
          }}
        />
        <button type="button" className="soft-button" onClick={(event) => { event.stopPropagation(); submitManual(); }}>添加</button>
      </div>
    </div>
  );
}

function TeachingClassesField({ draft, setDraft }) {
  const classes = draft.teachingClasses?.length ? draft.teachingClasses : [""];
  const profiles = draft.classProfiles || {};

  function profileFor(name) {
    return profiles[name] || { subject: "", isHomeroom: false, rosterFolders: [] };
  }

  function updateProfile(name, patch) {
    if (!name) return;
    setDraft({ ...draft, classProfiles: { ...profiles, [name]: { ...profileFor(name), ...patch } } });
  }

  function updateClass(index, value) {
    const oldName = classes[index];
    const next = [...classes];
    next[index] = value;
    const nextProfiles = { ...profiles };
    if (oldName && oldName !== value && nextProfiles[oldName]) {
      nextProfiles[value] = nextProfiles[oldName];
      delete nextProfiles[oldName];
    }
    setDraft({ ...draft, teachingClasses: next, classProfiles: nextProfiles });
  }

  function addClass() {
    setDraft({ ...draft, teachingClasses: [...classes, ""] });
  }

  function removeClass(index) {
    const name = classes[index];
    const next = classes.filter((_, i) => i !== index);
    const nextProfiles = { ...profiles };
    if (name) delete nextProfiles[name];
    setDraft({ ...draft, teachingClasses: next.length ? next : [""], classProfiles: nextProfiles });
  }

  async function pickClassRoster(name) {
    if (!appApi.chooseFolder || !name) return;
    const picked = await appApi.chooseFolder();
    const list = Array.isArray(picked) ? picked.filter(Boolean) : picked ? [picked] : [];
    if (!list.length) return;
    const current = normalizeFolderList(profileFor(name).rosterFolders);
    updateProfile(name, { rosterFolders: Array.from(new Set([...current, ...list])) });
  }

  function addManualClassRoster(name, value) {
    const trimmed = String(value || "").trim();
    if (!trimmed || !name) return;
    const current = normalizeFolderList(profileFor(name).rosterFolders);
    if (current.includes(trimmed)) return;
    updateProfile(name, { rosterFolders: [...current, trimmed] });
  }

  function removeClassRoster(name, index) {
    const current = normalizeFolderList(profileFor(name).rosterFolders);
    updateProfile(name, { rosterFolders: current.filter((_, i) => i !== index) });
  }

  return (
    <div className="teaching-classes-field">
      <span>任教班级（可添加多个，分别配置该班学生名单、任教学科与是否担任班主任；学生名单可先跳过，用演示名单，之后随时来系统设置里补充）</span>
      <div className="teaching-class-grid">
        {classes.map((className, index) => {
          const profile = profileFor(className);
          return (
            <div className="teaching-class-card" key={index}>
              <div className="teaching-classes-row">
                <input value={className} onChange={(event) => updateClass(index, event.target.value)} placeholder="如：预备5班" />
                {classes.length > 1 && <button type="button" onClick={() => removeClass(index)}><X size={13} /></button>}
              </div>
              <label className="inline-check teaching-class-homeroom-check">
                <input
                  type="checkbox"
                  checked={!!profile.isHomeroom}
                  onChange={(event) => updateProfile(className, { isHomeroom: event.target.checked })}
                />
                担任班主任
              </label>
              <input
                className="teaching-class-subject-input"
                placeholder="任教学科（如：语文）"
                value={profile.subject || ""}
                onChange={(event) => updateProfile(className, { subject: event.target.value })}
              />
              <FolderMultiField
                label="该班学生名单/信息表"
                values={normalizeFolderList(profile.rosterFolders)}
                onAdd={() => pickClassRoster(className)}
                onRemove={(idx) => removeClassRoster(className, idx)}
                onManualAdd={(value) => addManualClassRoster(className, value)}
              />
            </div>
          );
        })}
      </div>
      <button type="button" className="soft-button" onClick={addClass}><Plus size={14} />添加班级</button>
    </div>
  );
}

function SetupModal({ draft, setDraft, onSubmit, onClose, reviewReminder }) {
  const folderItems = [
    ["roster", "学生名单"],
    ["homeVisit", "家校沟通"],
    ["resume", "学生简历"],
    ["schedule", "班级课程"],
    ["cooperation", "小组合作"],
    ["leave", "请假凭证"]
  ];

  return (
    <div className="modal-backdrop setup-backdrop">
      <form className="setup-modal" onSubmit={onSubmit}>
        <div className="panel-title">
          <div>
            <h2>{onClose ? "首次进入基础设置（重新查看）" : "首次进入基础设置"}</h2>
            <span>这些信息会统一影响课表、教学工作台和所有"第几周"模块</span>
            {reviewReminder && <span className="setup-review-hint">系统刚更新，请检查一下各班级的设置项是否正确～</span>}
          </div>
          {onClose && <button type="button" onClick={onClose}>关闭</button>}
        </div>
        <div className="setup-grid">
          <label>上下学期<select value={draft.termPart} onChange={(event) => setDraft({ ...draft, termPart: event.target.value })}><option>上学期</option><option>下学期</option></select></label>
          <label>执教学科<input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label>开学日期<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
          <TeachingClassesField draft={draft} setDraft={setDraft} />
        </div>
        <TeacherIdentityFields draft={draft} setDraft={setDraft} />
        <section className="setup-folder-panel">
          <div>
            <h3>本地数据文件夹</h3>
            <span>本页所有文件夹都可以先不填，系统会自动使用演示数据；随时可以在"系统设置"里补充上传，不必现在一次填完。</span>
          </div>
          <div className="setup-folder-grid">
            {folderItems.map(([key, label]) => (
              <FolderMultiField
                key={key}
                label={label}
                values={normalizeFolderList((draft.dataFolders || {})[key])}
                onAdd={() => pickAndAddFolder(draft, setDraft, key)}
                onRemove={(index) => removeFolderAt(draft, setDraft, key, index)}
                onManualAdd={(value) => addManualFolder(draft, setDraft, key, value)}
              />
            ))}
          </div>
        </section>
        <div className="setup-submit-row">
          <button type="submit"><Save size={16} />保存并进入工作台</button>
          <button type="button" className="soft-button" onClick={() => onSubmit({ preventDefault: () => {} })}>暂时跳过，先用演示数据体验</button>
        </div>
      </form>
    </div>
  );
}

function parentContacts(student) {
  if (!student) return [];
  return [
    { label: "爸爸", relation: "爸爸", name: student.father_name || "爸爸", phone: student.father_phone || "" },
    { label: "妈妈", relation: "妈妈", name: student.mother_name || "妈妈", phone: student.mother_phone || "" },
    { label: student.guardian_relation || "家校联系人", relation: student.guardian_relation || "家校联系人", name: student.guardian || "", phone: student.guardian_phone || "" }
  ].filter((item, index, list) => (item.name || item.phone || index < 2) && list.findIndex((other) => other.relation === item.relation && other.phone === item.phone) === index);
}

function FamilyCommunicationPage({ data, familyDraft, setFamilyDraft, addFamilyCommunication, updateFamilyCommunication, deleteFamilyCommunication }) {
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const familyStudentPickerRef = useRef(null);
  useClickOutside(familyStudentPickerRef, () => setShowStudentPicker(false), showStudentPicker);
  const [quickFilter, setQuickFilter] = useState("all");
  const [studentFilter, setStudentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [metricDetail, setMetricDetail] = useState(null);
  const PAGE_SIZE = 20;
  const communicationTypes = ["学习反馈", "行为沟通", "请假记录", "重要通知", "家委工作", "其他"];
  const selectedContacts = familyDraft.contacts || [];

  // 默认自动选中该生的"家校联系人"对应家长（爸爸/妈妈），选不出来时兜底用有电话的那位
  function defaultRelationFor(student) {
    const guardianRelation = student.guardian_relation || "";
    if (guardianRelation.includes("妈")) return "妈妈";
    if (guardianRelation.includes("爸")) return "爸爸";
    if (student.father_phone) return "爸爸";
    if (student.mother_phone) return "妈妈";
    return "爸爸";
  }

  function addOrRemoveContact(student) {
    const exists = selectedContacts.some((item) => String(item.student_id) === String(student.id));
    const next = exists
      ? selectedContacts.filter((item) => String(item.student_id) !== String(student.id))
      : [...selectedContacts, { student_id: student.id, relation: defaultRelationFor(student) }];
    setFamilyDraft({ ...familyDraft, contacts: next });
  }

  function switchContactParent(studentId) {
    setFamilyDraft({
      ...familyDraft,
      contacts: selectedContacts.map((item) => (String(item.student_id) === String(studentId)
        ? { ...item, relation: item.relation === "爸爸" ? "妈妈" : "爸爸" }
        : item))
    });
  }

  function removeContact(studentId) {
    setFamilyDraft({ ...familyDraft, contacts: selectedContacts.filter((item) => String(item.student_id) !== String(studentId)) });
  }

  const studentPickerList = data.students.filter((student) => {
    const q = studentQuery.trim();
    if (!q) return true;
    return student.name.includes(q) || String(student.student_no || "").includes(q);
  });

  const stats = [
    { key: "all", label: "沟通记录", value: data.familyStats.total, Icon: MessageSquare, note: "家访、电话、微信、面谈统一归档" },
    { key: "leave", label: "请假记录", value: data.familyStats.leaveNotes, Icon: FileText, note: "家长发送图片或文件可存放" },
    { key: "pending", label: "待跟进", value: data.familyStats.pending, Icon: Bell, note: "未完成事项集中提醒" }
  ];
  const familyMetricDetails = {
    all: (data.familyCommunications || [])
      .slice()
      .sort((a, b) => String(b.communication_date || "").localeCompare(String(a.communication_date || "")))
      .slice(0, 12)
      .map((item) => ({
        title: `${item.communication_date || "-"} · ${item.student_name || "未关联学生"}`,
        meta: `${item.category || "沟通记录"} · ${item.channel || "未填方式"} · ${item.status || "待跟进"}`,
        note: item.title || item.content || "暂无主题"
      })),
    leave: (data.familyCommunications || [])
      .filter((item) => String(item.category || "").includes("请假"))
      .sort((a, b) => String(b.communication_date || "").localeCompare(String(a.communication_date || "")))
      .slice(0, 12)
      .map((item) => ({
        title: `${item.communication_date || "-"} · ${item.student_name || "未关联学生"}`,
        meta: `${item.leave_type || "请假"} · ${item.leave_period || "时段未填"}`,
        note: item.content || item.title || "暂无说明"
      })),
    pending: (data.familyCommunications || [])
      .filter((item) => item.status !== "已完成")
      .sort((a, b) => String(b.communication_date || "").localeCompare(String(a.communication_date || "")))
      .slice(0, 12)
      .map((item) => ({
        title: `${item.communication_date || "-"} · ${item.student_name || "未关联学生"}`,
        meta: `${item.category || "沟通记录"} · ${item.status || "待跟进"}`,
        note: item.followup || item.content || item.title || "暂无后续说明"
      }))
  };

  const filteredRecords = (data.familyCommunications || []).filter((item) => {
    if (quickFilter === "leave" && !String(item.category || "").includes("请假")) return false;
    if (quickFilter === "pending" && item.status === "已完成") return false;
    if (studentFilter && String(item.student_id || "") !== String(studentFilter) && item.student_name !== studentFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (searchText.trim()) {
      const keyword = searchText.trim();
      const haystack = `${item.title || ""}${item.content || ""}${item.student_name || ""}${item.category || ""}`;
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    const cmp = String(a.communication_date || "").localeCompare(String(b.communication_date || "")) || (Number(a.id) - Number(b.id));
    return sortDesc ? -cmp : cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRecords = sortedRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasActiveFilter = quickFilter !== "all" || studentFilter || statusFilter || searchText;

  function clearFilters() {
    setQuickFilter("all");
    setStudentFilter("");
    setStatusFilter("");
    setSearchText("");
    setPage(1);
  }

  return (
    <section className="family-page">
      <div className="metric-row family-metric-row">
        {stats.map((stat) => (
          <button
            type="button"
            className={`metric-card metric-card-clickable ${quickFilter === stat.key ? "is-active" : ""}`}
            key={stat.key}
            onClick={() => { setQuickFilter(stat.key); setMetricDetail(stat.key); setPage(1); }}
          >
            <stat.Icon size={20} />
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small>{stat.note}</small>
          </button>
        ))}
      </div>

      <section className="panel family-entry-panel">
        <div className="panel-title">
          <div>
            <h2>新增家校沟通记录</h2>
            <span>按学生归档家访信息、重要沟通、家长请假条等，可多选学生批量归档同一条记录</span>
          </div>
        </div>
        <form className="family-form" onSubmit={addFamilyCommunication}>
          <label className="dated-field field-block"><span>沟通日期</span><input type="date" value={familyDraft.communication_date} onChange={(event) => setFamilyDraft({ ...familyDraft, communication_date: event.target.value })} /></label>

          <div className="field-block family-student-multi-field" ref={familyStudentPickerRef}>
            <span>沟通学生（可多选，默认自动带出家校联系人，可切换爸爸/妈妈）</span>
            <div className="family-student-input-row">
              <input
                className="family-student-search"
                value={studentQuery}
                onChange={(event) => { setStudentQuery(event.target.value); setShowStudentPicker(true); }}
                onFocus={() => setShowStudentPicker(true)}
                placeholder="输入学生姓名或学号搜索"
              />
              <select
                className="family-student-select"
                value=""
                onChange={(event) => {
                  const student = data.students.find((item) => String(item.id) === event.target.value);
                  if (student) addOrRemoveContact(student);
                  event.target.value = "";
                }}
              >
                <option value="">或从下拉选择</option>
                {data.students.map((student) => (
                  <option key={student.id} value={student.id}>{student.class_name || ""}{student.student_no}号 {student.name}</option>
                ))}
              </select>
            </div>
            <div className="family-selected-tags">
              {selectedContacts.length === 0 && <span className="family-selected-empty">尚未选择学生</span>}
              {selectedContacts.map((item) => {
                const student = data.students.find((s) => String(s.id) === String(item.student_id));
                if (!student) return null;
                const canSwitch = student.father_phone && student.mother_phone;
                return (
                  <span className="family-selected-chip" key={item.student_id}>
                    <span>{student.name}·{item.relation}</span>
                    {canSwitch && <button type="button" title="切换家长" onClick={() => switchContactParent(item.student_id)}><RefreshCcw size={11} /></button>}
                    <button type="button" title="移除" onClick={() => removeContact(item.student_id)}><X size={11} /></button>
                  </span>
                );
              })}
            </div>
            {showStudentPicker && (
              <div className="family-student-grid">
                {studentPickerList.map((student) => {
                  const contact = selectedContacts.find((item) => String(item.student_id) === String(student.id));
                  const phone = contact ? (contact.relation === "妈妈" ? student.mother_phone : student.father_phone) : "";
                  return (
                    <button
                      type="button"
                      key={student.id}
                      className={`family-student-chip ${student.gender === "女" ? "girl" : "boy"} ${contact ? "is-checked" : ""}`}
                      onClick={() => addOrRemoveContact(student)}
                    >
                      <span className="family-student-chip-name">{student.class_name || ""}{student.student_no}号 {student.name}</span>
                      {contact && <small>{contact.relation}{phone ? ` ${phone}` : ""}</small>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <label className="field-block">
            <span>沟通方式</span>
            <select value={familyDraft.channel} onChange={(event) => setFamilyDraft({ ...familyDraft, channel: event.target.value })}>
              <option>微信</option>
              <option>电话</option>
              <option>面谈</option>
              <option>家访</option>
              <option>短信</option>
              <option>其他</option>
            </select>
          </label>

          <label className="field-block">
            <span>状态</span>
            <select value={familyDraft.status} onChange={(event) => setFamilyDraft({ ...familyDraft, status: event.target.value })}>
              <option>待跟进</option>
              <option>进行中</option>
              <option>已完成</option>
            </select>
          </label>

          <div className="field-block family-type-field">
            <span>沟通类型（可多选）</span>
            <div className="type-checks">
              {communicationTypes.map((type) => {
                const selected = Array.isArray(familyDraft.category)
                  ? familyDraft.category.includes(type)
                  : String(familyDraft.category || "").split(/[、,，]/).includes(type);
                return (
                  <label className={selected ? "is-checked" : ""} key={type}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        const current = Array.isArray(familyDraft.category)
                          ? familyDraft.category
                          : String(familyDraft.category || "").split(/[、,，]/).filter(Boolean);
                        const next = event.target.checked
                          ? Array.from(new Set([...current, type]))
                          : current.filter((item) => item !== type);
                        setFamilyDraft({ ...familyDraft, category: next, is_leave: type === "请假记录" && event.target.checked ? true : familyDraft.is_leave });
                      }}
                    />
                    {type}
                  </label>
                );
              })}
            </div>
          </div>

          <label className="field-block family-title-field">
            <span>沟通主题</span>
            <input className="family-title-input" placeholder="沟通主题" value={familyDraft.title} onChange={(event) => setFamilyDraft({ ...familyDraft, title: event.target.value })} />
          </label>

          <label className="field-block family-content-field">
            <span>沟通内容</span>
            <textarea placeholder="沟通内容 / 家访情况 / 请假说明" value={familyDraft.content} onChange={(event) => setFamilyDraft({ ...familyDraft, content: event.target.value })} />
          </label>

          {(Array.isArray(familyDraft.category) ? familyDraft.category.includes("请假记录") : String(familyDraft.category).includes("请假")) && (
            <div className="leave-inline-fields">
              <label>同步请假<input type="checkbox" checked={familyDraft.is_leave} onChange={(event) => setFamilyDraft({ ...familyDraft, is_leave: event.target.checked })} /></label>
              <label>请假时段<select
                value={["全天", "上午", "下午"].includes(familyDraft.leave_period) ? familyDraft.leave_period : "自定义"}
                onChange={(event) => setFamilyDraft({ ...familyDraft, leave_period: event.target.value === "自定义" ? "" : event.target.value })}
              ><option>全天</option><option>上午</option><option>下午</option><option>自定义</option></select></label>
              {!["全天", "上午", "下午"].includes(familyDraft.leave_period) && (
                <label>自定义时段<input value={familyDraft.leave_period} onChange={(event) => setFamilyDraft({ ...familyDraft, leave_period: event.target.value })} placeholder="如 8:00-10:30" /></label>
              )}
              <label>类型<select value={familyDraft.leave_type} onChange={(event) => setFamilyDraft({ ...familyDraft, leave_type: event.target.value })}><option>病假</option><option>事假</option><option>其他</option></select></label>
              <label>备注<input value={familyDraft.leave_remark} onChange={(event) => setFamilyDraft({ ...familyDraft, leave_remark: event.target.value })} /></label>
            </div>
          )}
          <label className="attach-button">
            <Paperclip size={15} />上传附件
            <input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setFamilyDraft({ ...familyDraft, attachment_path: file?.path || "" });
              }}
            />
          </label>
          <button type="submit"><Save size={16} />保存记录</button>
        </form>
      </section>

      <section className="panel communication-list-panel">
        <div className="panel-title">
          <div>
            <h2>沟通记录</h2>
            <span>共 {sortedRecords.length} 条 · 每页 {PAGE_SIZE} 条</span>
          </div>
        </div>
        <div className="record-filter-bar">
          <input placeholder="搜索学生 / 标题 / 内容" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} />
          <select value={studentFilter} onChange={(event) => { setStudentFilter(event.target.value); setPage(1); }}>
            <option value="">全部学生</option>
            {data.students.map((student) => <option value={student.id} key={student.id}>{student.student_no}. {student.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option>待跟进</option>
            <option>进行中</option>
            <option>已完成</option>
          </select>
          <button type="button" className="soft-button" onClick={() => setSortDesc((value) => !value)}>{sortDesc ? "时间倒序 ↓" : "时间正序 ↑"}</button>
          {hasActiveFilter && <button type="button" className="soft-button" onClick={clearFilters}>清除筛选</button>}
        </div>
        <div className="record-table">
          <div className="record-table-head">
            <b>日期</b><b>学生</b><b>类型</b><b>方式</b><b>主题</b><b>状态</b><b>操作</b>
          </div>
          {pageRecords.length === 0 && <div className="empty-row">没有符合条件的记录。</div>}
          {pageRecords.map((item) => (
            <div className="record-table-row" key={item.id}>
              <span>{item.communication_date}</span>
              <span>{item.student_name || "未关联"}</span>
              <span>{item.category || "-"}</span>
              <span>{item.channel || "-"}</span>
              <button type="button" className="record-title-link" onClick={() => setSelectedRecord(item)}>{item.title || "（无主题）"}</button>
              <select value={item.status || "待跟进"} onChange={(event) => updateFamilyCommunication({ ...item, status: event.target.value })}>
                <option>待跟进</option>
                <option>进行中</option>
                <option>已完成</option>
              </select>
              <div className="record-row-actions">
                <button type="button" onClick={() => setSelectedRecord(item)}>详情</button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => { if (window.confirm(`确定删除「${item.title || "该记录"}」吗？`)) deleteFamilyCommunication(item.id); }}
                >
                  <Trash2 size={13} />删除
                </button>
              </div>
            </div>
          ))}
        </div>
        {sortedRecords.length > 0 && (
          <div className="record-pagination">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
            <span>第 {currentPage} / {totalPages} 页</span>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>
        )}
      </section>
      {selectedRecord && <CommunicationDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
      {metricDetail && (
        <QuickDetailModal
          title={`${stats.find((item) => item.key === metricDetail)?.label || "家校沟通"}速览`}
          subtitle="显示最近相关记录"
          items={familyMetricDetails[metricDetail]}
          onClose={() => setMetricDetail(null)}
        />
      )}
    </section>
  );
}

function CommunicationDetail({ record, onClose }) {
  return (
    <div className="modal-backdrop work-area-backdrop family-detail-backdrop">
      <section className="detail-modal">
        <div className="panel-title">
          <div>
            <h2>{record.title}</h2>
            <span>{record.communication_date} · {record.student_name || "未关联学生"}</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="record-detail-grid">
          <span>沟通类型</span><b>{record.category || "-"}</b>
          <span>沟通方式</span><b>{record.channel || "-"}</b>
          <span>联系人</span><b>{record.relation || record.contact_person || "-"}</b>
          <span>状态</span><b>{record.status || "-"}</b>
          <span>后续跟进</span><b>{record.follow_up_date || "-"}</b>
          <span>附件</span><b>{record.original_name || "无附件"}</b>
        </div>
        <div className="detail-block">
          <b>沟通内容</b>
          <span>{record.content || "暂无详细内容"}</span>
        </div>
        <div className="detail-block">
          <b>附件内容</b>
          <span>{record.extracted_text || (record.original_name ? "该附件暂未解析出文字内容，可在附件文件夹中查看原文件。" : "无附件")}</span>
        </div>
      </section>
    </div>
  );
}

function FamilyCollaborationPage({ data, addFamilyCommittee, updateFamilyCommittee, addFamilyActivity, updateFamilyActivity }) {
  const classes = data.appConfig?.teachingClasses?.length ? data.appConfig.teachingClasses : Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean)));
  const firstClass = classes[0] || "演示1班";
  const [committeeDraft, setCommitteeDraft] = useState({ class_name: firstClass, student_name: "", relation: "妈妈", parent_name: "", role: "", phone: "", note: "" });
  const [activityDraft, setActivityDraft] = useState({ class_name: firstClass, activity_date: todayIso(), title: "", activity_type: "班级活动", description: "", parent_division: "", status: "筹备中" });
  const [editingCommittee, setEditingCommittee] = useState({});
  const [editingActivity, setEditingActivity] = useState({});
  const [selectedActivity, setSelectedActivity] = useState(null);
  const committeeRows = data.familyCommittee || [];
  const activities = data.familyActivities || [];
  const studentNames = data.students.map((student) => student.name);

  function fillCommitteeFromStudent(studentName, relation = committeeDraft.relation, overrides = {}) {
    const student = data.students.find((item) => item.name === studentName);
    const contact = parentContacts(student).find((item) => item.relation === relation)
      || parentContacts(student)[0]
      || {};
    setCommitteeDraft({
      ...committeeDraft,
      ...overrides,
      student_name: studentName,
      relation,
      parent_name: contact.name || (relation === "爸爸" || relation === "妈妈" ? relation : ""),
      phone: contact.phone || ""
    });
  }

  async function submitCommittee(event) {
    await addFamilyCommittee(event, committeeDraft);
    setCommitteeDraft({ ...committeeDraft, student_name: "", parent_name: "", role: "", phone: "", note: "" });
  }

  async function submitActivity(event) {
    await addFamilyActivity(event, activityDraft);
    setActivityDraft({ ...activityDraft, title: "", description: "", parent_division: "", status: "筹备中" });
  }

  return (
    <section className="family-page">
      <section className="panel family-collab-panel">
        <div className="panel-title">
          <div>
            <h2>家委会名单</h2>
            <span>列表形式记录联系人、对应学生和家委会职务</span>
          </div>
        </div>
        <form className="compact-entry-form family-collab-form" onSubmit={submitCommittee}>
          <select value={committeeDraft.class_name} onChange={(event) => setCommitteeDraft({ ...committeeDraft, class_name: event.target.value })}>
            {classes.map((className) => <option key={className}>{className}</option>)}
          </select>
          <input list="family-student-names" placeholder="学生姓名" value={committeeDraft.student_name} onChange={(event) => fillCommitteeFromStudent(event.target.value)} />
          <select value={committeeDraft.relation} onChange={(event) => fillCommitteeFromStudent(committeeDraft.student_name, event.target.value)}>
            <option>妈妈</option>
            <option>爸爸</option>
            <option>其他家长</option>
          </select>
          <input placeholder="家长姓名（选填）" value={committeeDraft.parent_name} onChange={(event) => setCommitteeDraft({ ...committeeDraft, parent_name: event.target.value })} />
          <input placeholder="家委会职务" value={committeeDraft.role} onChange={(event) => setCommitteeDraft({ ...committeeDraft, role: event.target.value })} />
          <input placeholder="联系方式" value={committeeDraft.phone} onChange={(event) => setCommitteeDraft({ ...committeeDraft, phone: event.target.value })} />
          <input placeholder="备注" value={committeeDraft.note} onChange={(event) => setCommitteeDraft({ ...committeeDraft, note: event.target.value })} />
          <button type="submit"><Plus size={15} />新增</button>
        </form>
        <datalist id="family-student-names">
          {studentNames.map((name) => <option value={name} key={name} />)}
        </datalist>
        <div className="committee-table">
          <div className="committee-head"><b>联系人</b><b>姓名</b><b>家委会职务</b><b>联系方式</b><b>备注</b><b>操作</b></div>
          {committeeRows.map((row) => {
            const draft = editingCommittee[row.id] || row;
            return (
              <div className="committee-row" key={row.id}>
                <span>{draft.parent_name || `${draft.student_name}${draft.relation}`}</span>
                <input value={draft.student_name || ""} onChange={(event) => setEditingCommittee({ ...editingCommittee, [row.id]: { ...draft, student_name: event.target.value } })} />
                <input value={draft.role || ""} onChange={(event) => setEditingCommittee({ ...editingCommittee, [row.id]: { ...draft, role: event.target.value } })} />
                <input value={draft.phone || ""} onChange={(event) => setEditingCommittee({ ...editingCommittee, [row.id]: { ...draft, phone: event.target.value } })} />
                <input value={draft.note || ""} onChange={(event) => setEditingCommittee({ ...editingCommittee, [row.id]: { ...draft, note: event.target.value } })} />
                <button type="button" onClick={() => updateFamilyCommittee(draft)}><Save size={14} />保存</button>
              </div>
            );
          })}
          {committeeRows.length === 0 && <div className="empty-row">还没有家委会名单，可从上方新增。</div>}
        </div>
      </section>

      <section className="panel family-collab-panel">
        <div className="panel-title">
          <div>
            <h2>班级活动</h2>
            <span>记录活动项目、活动说明与家长分工</span>
          </div>
        </div>
        <form className="family-activity-form" onSubmit={submitActivity}>
          <input type="date" value={activityDraft.activity_date} onChange={(event) => setActivityDraft({ ...activityDraft, activity_date: event.target.value })} />
          <select value={activityDraft.class_name} onChange={(event) => setActivityDraft({ ...activityDraft, class_name: event.target.value })}>{classes.map((className) => <option key={className}>{className}</option>)}</select>
          <input placeholder="活动项目" value={activityDraft.title} onChange={(event) => setActivityDraft({ ...activityDraft, title: event.target.value })} />
          <select value={activityDraft.status} onChange={(event) => setActivityDraft({ ...activityDraft, status: event.target.value })}><option>筹备中</option><option>进行中</option><option>已完成</option></select>
          <textarea placeholder="活动说明" value={activityDraft.description} onChange={(event) => setActivityDraft({ ...activityDraft, description: event.target.value })} />
          <label className="attach-button"><Paperclip size={15} />活动文件
            <input type="file" onChange={(event) => setActivityDraft({ ...activityDraft, attachment_path: event.target.files?.[0]?.path || "", activity_file_name: event.target.files?.[0]?.name || "" })} />
          </label>
          <button type="submit"><Plus size={15} />新增活动</button>
        </form>
        <div className="family-activity-list">
          {activities.map((activity) => {
            const draft = editingActivity[activity.id] || activity;
            return (
              <article key={activity.id}>
                <div>
                  <button type="button" className="link-title-button" onClick={() => setSelectedActivity(activity)}>{activity.activity_date} · {activity.title}</button>
                  <span>{activity.class_name} · {activity.status}{activity.activity_file_name ? ` · ${activity.activity_file_name}` : ""}</span>
                </div>
                <select value={draft.status || "筹备中"} onChange={(event) => setEditingActivity({ ...editingActivity, [activity.id]: { ...draft, status: event.target.value } })}><option>筹备中</option><option>进行中</option><option>已完成</option></select>
                <button type="button" onClick={() => updateFamilyActivity(draft)}><Save size={14} />保存</button>
              </article>
            );
          })}
          {activities.length === 0 && <div className="empty-row">还没有班级活动，可从上方新增。</div>}
        </div>
      </section>
      {selectedActivity && (
        <FamilyActivityDetailModal
          activity={selectedActivity}
          committeeRows={committeeRows.filter((row) => !selectedActivity.class_name || row.class_name === selectedActivity.class_name)}
          onClose={() => setSelectedActivity(null)}
          onSave={async (next) => {
            await updateFamilyActivity(next);
            setSelectedActivity(null);
          }}
        />
      )}
    </section>
  );
}

function parseDivisionMap(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function FamilyActivityDetailModal({ activity, committeeRows, onClose, onSave }) {
  const [draft, setDraft] = useState(activity);
  const divisionMap = parseDivisionMap(draft.parent_division);

  function setDivision(rowId, value) {
    const nextMap = { ...divisionMap, [rowId]: value };
    setDraft({ ...draft, parent_division: JSON.stringify(nextMap) });
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <section className="detail-modal family-activity-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h2>{activity.title}</h2>
            <span>{activity.class_name} · {activity.activity_date} · {activity.status}</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <label>活动说明<textarea value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        {activity.activity_file_name && <div className="file-note"><Paperclip size={15} />{activity.activity_file_name}</div>}
        <div className="committee-assignment-list">
          <div className="committee-assignment-head"><b>家长</b><b>学生</b><b>分工</b></div>
          {committeeRows.map((row) => (
            <div className="committee-assignment-row" key={row.id}>
              <span>{row.parent_name || `${row.student_name}${row.relation}`}</span>
              <span>{row.student_name}</span>
              <input value={divisionMap[row.id] || ""} onChange={(event) => setDivision(row.id, event.target.value)} placeholder="填写该家长分工" />
            </div>
          ))}
          {committeeRows.length === 0 && <div className="empty-row">还没有家委会联系人，先在上方名单中新增。</div>}
        </div>
        <button type="button" className="small-primary-button" onClick={() => onSave(draft)}><Save size={15} />保存活动详情</button>
      </section>
    </div>,
    document.body
  );
}

function FamilyPendingPage({ data, updateFamilyCommunication }) {
  const [drafts, setDrafts] = useState({});
  const pendingRows = (data.familyCommunications || []).filter((record) => ["待跟进", "进行中", "跟进中"].includes(record.status));

  function draftFor(record) {
    return drafts[record.id] || record;
  }

  async function saveRecord(record) {
    await updateFamilyCommunication(draftFor(record));
  }

  return (
    <section className="family-page">
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>未完成事项</h2>
            <span>自动识别家校沟通中“待跟进 / 进行中”的记录，可标注截止日期</span>
          </div>
        </div>
        <div className="family-pending-list">
          <div className="pending-head"><b>日期</b><b>学生</b><b>事项</b><b>状态</b><b>截止日期</b><b>操作</b></div>
          {pendingRows.map((record) => {
            const draft = draftFor(record);
            return (
              <div className="pending-row" key={record.id}>
                <span>{record.communication_date}</span>
                <b>{record.student_name || "未关联"}</b>
                <span>{record.title}<small>{record.category}</small></span>
                <select value={draft.status || "待跟进"} onChange={(event) => setDrafts({ ...drafts, [record.id]: { ...draft, status: event.target.value } })}>
                  <option>待跟进</option>
                  <option>进行中</option>
                  <option>已完成</option>
                </select>
                <input type="date" value={draft.deadline_date || ""} onChange={(event) => setDrafts({ ...drafts, [record.id]: { ...draft, deadline_date: event.target.value } })} />
                <button type="button" onClick={() => saveRecord(record)}><Save size={14} />保存</button>
              </div>
            );
          })}
          {pendingRows.length === 0 && <div className="empty-row">当前没有待跟进或进行中的家校事项。</div>}
        </div>
      </section>
    </section>
  );
}

function SubjectPage({
  data,
  teachingClass,
  setTeachingClass,
  planDraft,
  setPlanDraft,
  homeworkDraft,
  setHomeworkDraft,
  addPlan,
  togglePlan,
  addHomework,
  addHomeworkPayload,
  updateHomework,
  updateSubjectPlan,
  deleteSubjectPlan,
  deleteHomework,
  addPlanningBundle,
  activeTeachingPage,
  setActiveTeachingPage,
  recitationDraft,
  setRecitationDraft,
  assessmentDraft,
  setAssessmentDraft,
  addRecitation,
  addRecitationPayload,
  updateRecitation,
  deleteRecitation,
  addAssessment,
  updateAssessment,
  deleteAssessment,
  setAssessmentScore,
  setTaskStudentStatus
}) {
  const [subjectMonth, setSubjectMonth] = useState(monthIso(planDraft.plan_date || todayIso()));
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [metricDetail, setMetricDetail] = useState(null);
  const [creationMode, setCreationMode] = useState("plan");
  const [linkedHomework, setLinkedHomework] = useState({ title: "", homework_type: "日常作业", assign_date: "", due_date: "", class_name: "", note: "" });
  const [linkedRecitation, setLinkedRecitation] = useState({ title: "", recitation_type: "背诵", assign_date: "", due_date: "", class_name: "", content: "", note: "" });
  const [homeworkExport, setHomeworkExport] = useState({
    startDate: "2026-08-01",
    endDate: "2026-12-31",
    studentId: "all"
  });
  const classStudents = data.students.filter((student) => student.class_name === teachingClass);
  const syncedStudentCount = data.appConfig.teachingClasses.reduce((sum, className) => {
    return sum + data.students.filter((student) => student.class_name === className).length;
  }, 0);
  const homeworkDraftStudentCount = homeworkDraft.class_name
    ? data.students.filter((student) => student.class_name === homeworkDraft.class_name).length
    : syncedStudentCount;
  const plans = data.subject.plans.filter((plan) => !plan.class_name || plan.class_name === teachingClass);
  const homework = data.subject.homework.filter((task) => !task.class_name || task.class_name === teachingClass);
  const recitations = (data.subject.recitations || []).filter((task) => !task.class_name || task.class_name === teachingClass);
  const assessmentTests = buildAssessmentItems(data).filter((test) => !test.class_name || test.class_name === teachingClass);
  const planDone = plans.filter((item) => item.is_done).length;
  const homeworkDone = homework.filter((item) => item.is_done).length;
  const testCount = plans.filter((item) => item.lesson_type === "学科测试").length + (data.subject.assessments || []).length;
  const homeworkPending = homework.reduce((sum, item) => sum + Math.max(0, item.assigned_count - item.submitted_count), 0);
  const homeworkIssue = homework.reduce((sum, item) => sum + Number(item.issue_count || 0), 0);
  const monthDays = buildMonthDays(subjectMonth);
  const monthPlans = plans.filter((plan) => plan.plan_date?.slice(0, 7) === subjectMonth);
  const stats = [
    ["教学任务", plans.length, BookOpenCheck, `${planDone} 项已完成`],
    ["作业", homework.length, ClipboardList, `${homeworkDone} 项已完成`],
    ["背默", recitations.length, ListChecks, `${recitations.filter((item) => item.is_done).length} 项已完成`],
    ["测试", testCount, Trophy, "学科测试与测评"]
  ];
  const currentWeek = defaultWeekRange();
  const assessmentPlans = plans
    .filter((item) => item.lesson_type === "学科测试")
    .map((item) => ({ title: item.lesson_title, meta: `${item.plan_date} · ${item.class_name || "5班、6班同步"}`, note: item.resources || item.note || "来自教学规划" }));
  const subjectMetricDetails = {
    教学任务: plans
      .filter((item) => item.plan_date >= currentWeek.start && item.plan_date <= currentWeek.end)
      .map((item) => ({ title: item.lesson_title, meta: `${item.plan_date} · ${item.class_name || "5班、6班同步"} · ${item.lesson_type || "新授课"}`, note: item.is_done ? "已完成" : (item.lesson_goal || "未完成") })),
    作业: homework
      .filter((item) => (item.assign_date || item.due_date || "") >= currentWeek.start && (item.assign_date || item.due_date || "") <= currentWeek.end)
      .map((item) => ({ title: item.title, meta: `${item.assign_date || "-"} 至 ${item.due_date || "-"} · ${item.class_name || "5班、6班同步"}`, note: `${item.homework_type || "日常作业"} · 已收 ${item.submitted_count || 0}/${item.assigned_count || 0}` })),
    背默: recitations
      .filter((item) => (item.assign_date || item.due_date || "") >= currentWeek.start && (item.assign_date || item.due_date || "") <= currentWeek.end)
      .map((item) => ({ title: item.title, meta: `${item.assign_date || "-"} 至 ${item.due_date || "-"} · ${item.class_name || "5班、6班同步"}`, note: item.content || item.recitation_type || "背默任务" })),
    测试: [...assessmentPlans, ...assessmentTests.map((item) => ({ title: item.title, meta: `${item.test_date || "-"} · ${item.class_name || "5班、6班同步"} · ${item.test_type || "测评"}`, note: `平均分 ${item.avg_score || "-"} · 及格率 ${item.pass_rate || "-"}` }))]
  };

  function openTaskForDay(kind, dateValue, event) {
    event?.stopPropagation();
    setEditingTask(null);
    setCreationMode(kind);
    if (kind === "plan") {
      setPlanDraft({
        ...planDraft,
        plan_date: dateValue,
        class_name: "",
        subject: data.appConfig.subject || planDraft.subject || "语文",
        lesson_type: "新授课",
        lesson_title: "",
        lesson_goal: "",
        resources: "",
        note: ""
      });
    }
    if (kind === "homework") {
      setLinkedHomework({ title: "", homework_type: "日常作业", assign_date: dateValue, due_date: dateValue, class_name: "", note: "" });
    }
    if (kind === "recitation") {
      setLinkedRecitation({ title: "", recitation_type: "背诵", assign_date: dateValue, due_date: dateValue, class_name: "", content: "", note: "" });
    }
    setShowPlanModal(true);
  }

  async function submitPlanFromModal(event) {
    event.preventDefault();
    if (editingTask?.kind === "plan") {
      await updateSubjectPlan(editingTask.item, planDraft);
    } else if (editingTask?.kind === "homework") {
      await updateHomework(editingTask.item, linkedHomework);
    } else if (editingTask?.kind === "recitation") {
      await updateRecitation(editingTask.item, linkedRecitation);
    } else if (creationMode === "plan") {
      if (!planDraft.lesson_title.trim()) return;
      await addPlanningBundle(event, { homework: { title: "" }, recitation: { title: "" } });
    } else if (creationMode === "homework") {
      await addHomeworkPayload({
        ...linkedHomework,
        subject: data.appConfig.subject || "语文",
        assign_date: linkedHomework.assign_date || linkedHomework.due_date || todayIso(),
        due_date: linkedHomework.due_date || linkedHomework.assign_date || todayIso()
      });
    } else if (creationMode === "recitation") {
      await addRecitationPayload({
        ...linkedRecitation,
        subject: data.appConfig.subject || "语文",
        assign_date: linkedRecitation.assign_date || linkedRecitation.due_date || todayIso(),
        due_date: linkedRecitation.due_date || linkedRecitation.assign_date || todayIso()
      });
    } else {
      return;
    }
    setShowPlanModal(false);
  }

  function editCalendarTask(kind, item, event) {
    event.stopPropagation();
    if (kind === "plan") {
      setCreationMode("plan");
      setEditingTask({ kind, item });
      setPlanDraft({ ...item });
      setShowPlanModal(true);
      return;
    }
    setCreationMode(kind);
    setEditingTask({ kind, item });
    if (kind === "homework") {
      setLinkedHomework({
        title: item.title || "",
        homework_type: item.homework_type || "日常作业",
        assign_date: item.assign_date || item.due_date || todayIso(),
        due_date: item.due_date || item.assign_date || todayIso(),
        class_name: item.class_name || "",
        note: item.note || ""
      });
    }
    if (kind === "recitation") {
      setLinkedRecitation({
        title: item.title || "",
        recitation_type: item.recitation_type || "背诵",
        assign_date: item.assign_date || item.due_date || todayIso(),
        due_date: item.due_date || item.assign_date || todayIso(),
        class_name: item.class_name || "",
        content: item.content || "",
        note: item.note || ""
      });
    }
    setShowPlanModal(true);
  }

  async function deleteEditingTask() {
    if (!editingTask?.item) return;
    if (editingTask.kind === "plan") await deleteSubjectPlan(editingTask.item);
    if (editingTask.kind === "homework") await deleteHomework(editingTask.item);
    if (editingTask.kind === "recitation") await deleteRecitation(editingTask.item);
    setShowPlanModal(false);
  }

  if (activeTeachingPage?.startsWith("homework-")) {
    const className = activeTeachingPage.replace("homework-", "");
    return (
      <TaskManagementPage
        data={data}
        className={className}
        taskKind="homework"
        draft={homeworkDraft}
        setDraft={setHomeworkDraft}
        addTask={addHomework}
        updateTask={updateHomework}
        deleteTask={deleteHomework}
        setTaskStudentStatus={setTaskStudentStatus}
      />
    );
  }

  if (activeTeachingPage === "homework") {
    return (
      <TaskOverviewPage
        data={data}
        taskKind="homework"
        tasks={data.subject.homework}
        setTeachingClass={setTeachingClass}
        addTask={addHomeworkPayload}
        updateTask={updateHomework}
        deleteTask={deleteHomework}
      />
    );
  }

  if (activeTeachingPage?.startsWith("recitation-")) {
    const className = activeTeachingPage.replace("recitation-", "");
    return (
      <TaskManagementPage
        data={data}
        className={className}
        taskKind="recitation"
        draft={recitationDraft}
        setDraft={setRecitationDraft}
        addTask={addRecitation}
        updateTask={updateRecitation}
        deleteTask={deleteRecitation}
        setTaskStudentStatus={setTaskStudentStatus}
      />
    );
  }

  if (activeTeachingPage === "recitation") {
    return (
      <TaskOverviewPage
        data={data}
        taskKind="recitation"
        tasks={data.subject.recitations || []}
        setTeachingClass={setTeachingClass}
        addTask={addRecitationPayload}
        updateTask={updateRecitation}
        deleteTask={deleteRecitation}
      />
    );
  }

  if (activeTeachingPage?.startsWith("assessment-")) {
    const className = activeTeachingPage.replace("assessment-", "");
    return (
      <AssessmentManagementPage
        data={data}
        className={className}
        addAssessment={addAssessment}
        updateAssessment={updateAssessment}
        deleteAssessment={deleteAssessment}
        setAssessmentScore={setAssessmentScore}
      />
    );
  }

  if (activeTeachingPage === "assessment") {
    return (
      <AssessmentOverviewPage
        data={data}
        draft={assessmentDraft}
        setDraft={setAssessmentDraft}
        addAssessment={addAssessment}
        updateAssessment={updateAssessment}
        deleteAssessment={deleteAssessment}
        setTeachingClass={setTeachingClass}
        setActiveTeachingPage={setActiveTeachingPage}
      />
    );
  }

  async function exportHomeworkIssues() {
    await appApi.exportHomeworkIssues({
      className: teachingClass,
      startDate: homeworkExport.startDate,
      endDate: homeworkExport.endDate,
      studentId: homeworkExport.studentId
    });
  }

  async function exportSubjectReview() {
    await appApi.exportSubjectReview({
      className: teachingClass,
      month: subjectMonth
    });
  }

  return (
    <section className="subject-page">
      <div className="metric-row">
        {stats.map(([label, value, Icon, note]) => (
          <button className="metric-card" type="button" key={label} onClick={() => setMetricDetail(label)}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </button>
        ))}
      </div>

      <div className="subject-layout">
        <section className="panel subject-plan-panel">
          <div className="panel-title">
            <div>
              <h2>学科教学规划</h2>
              <span>月视图安排每日教学任务，完成后直接打钩留痕</span>
            </div>
            <div className="subject-actions">
              <select className="class-switcher" value={teachingClass} onChange={(event) => setTeachingClass(event.target.value)}>
                {data.appConfig.teachingClasses.map((className) => <option key={className}>{className}</option>)}
              </select>
              <button type="button" className="small-primary-button" onClick={exportSubjectReview}><Download size={15} />导出教学复盘</button>
            </div>
          </div>

          <div className="month-toolbar">
            <input type="month" value={subjectMonth} onChange={(event) => setSubjectMonth(event.target.value)} />
              <span>{subjectMonth} · {monthPlans.length} 项教学任务 · 授课班级 5班、6班共 {syncedStudentCount} 人</span>
          </div>

          <div className="month-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => <b className="month-weekday" key={day}>周{day}</b>)}
            {monthDays.map((day) => {
              const dayPlans = plans.filter((plan) => plan.plan_date === day.iso);
              const dayHomework = homework.filter((task) => task.assign_date === day.iso);
              const dayRecitations = recitations.filter((task) => task.assign_date === day.iso);
              return (
                <div className={`month-day ${day.isCurrentMonth ? "" : "is-outside"}`} key={day.iso}>
                  <span className="month-date">{day.day}</span>
                  <i>{day.weekday}</i>
                  <div className="day-task-lanes">
                    <div className="task-lane">
                      {dayPlans.map((plan) => (
                        <span className={`calendar-chip lesson ${plan.lesson_type === "学科测试" ? "assessment" : ""} ${plan.is_done ? "is-done" : ""}`} key={`p-${plan.id}`}>
                          <button
                            type="button"
                            className="calendar-done-toggle"
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePlan(plan);
                            }}
                            aria-label={plan.is_done ? "标记为未完成" : "标记为已完成"}
                          >
                            {plan.is_done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                          </button>
                          <button type="button" className="calendar-chip-title" onClick={(event) => editCalendarTask("plan", plan, event)}>{plan.lesson_type === "学科测试" ? "测试" : "授课"} · {plan.lesson_title}</button>
                        </span>
                      ))}
                      {!dayPlans.length && <button className="calendar-chip lesson is-placeholder" type="button" onClick={(event) => openTaskForDay("plan", day.iso, event)}>+教学任务</button>}
                    </div>
                    <div className="task-lane">
                      {dayHomework.map((task) => (
                        <button className={`calendar-chip homework ${task.is_done ? "is-done" : ""}`} type="button" key={`h-${task.id}`} onClick={(event) => editCalendarTask("homework", task, event)}>作业 · {task.title}</button>
                      ))}
                      {!dayHomework.length && <button className="calendar-chip homework is-placeholder" type="button" onClick={(event) => openTaskForDay("homework", day.iso, event)}>+作业</button>}
                    </div>
                    <div className="task-lane">
                      {dayRecitations.map((task) => (
                        <button className={`calendar-chip recitation ${task.is_done ? "is-done" : ""}`} type="button" key={`r-${task.id}`} onClick={(event) => editCalendarTask("recitation", task, event)}>背默 · {task.title}</button>
                      ))}
                      {!dayRecitations.length && <button className="calendar-chip recitation is-placeholder" type="button" onClick={(event) => openTaskForDay("recitation", day.iso, event)}>+背默</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="plan-list">
            {plans.map((plan) => (
              <article className={`plan-row ${plan.is_done ? "is-done" : ""}`} key={plan.id}>
                <button type="button" className="check-button" onClick={() => togglePlan(plan)} aria-label="切换完成状态">
                  {plan.is_done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                </button>
                <div>
                  <b>{plan.week_label} · {plan.plan_date} · {plan.lesson_title}</b>
                  <span><small className="tag-pill">{plan.lesson_type || "新授课"}</small>{plan.subject} · {plan.class_name || "5班、6班同步"}</span>
                  <p>{plan.lesson_goal || "暂无目标说明"}</p>
                </div>
                <em>{plan.resources || "无资料"}</em>
              </article>
            ))}
          </div>
        </section>
      </div>

      {showPlanModal && (
        <div className="modal-backdrop work-area-backdrop">
          <form className="cell-editor plan-editor" onSubmit={submitPlanFromModal}>
            <div className="panel-title">
              <div>
                <h2>{editingTask ? "修改" : "新建"}{creationMode === "homework" ? "作业" : creationMode === "recitation" ? "背默" : "教学任务"}</h2>
                <span>
                  {creationMode === "homework"
                    ? `${linkedHomework.assign_date || linkedHomework.due_date} · ${weekdayLabel(linkedHomework.assign_date || linkedHomework.due_date)} · ${linkedHomework.class_name || "5班、6班同步"}`
                    : creationMode === "recitation"
                      ? `${linkedRecitation.assign_date || linkedRecitation.due_date} · ${weekdayLabel(linkedRecitation.assign_date || linkedRecitation.due_date)} · ${linkedRecitation.class_name || "5班、6班同步"}`
                      : `${planDraft.plan_date} · ${weekdayLabel(planDraft.plan_date)} · ${planDraft.class_name || "5班、6班同步"}`}
                </span>
              </div>
              <button type="button" onClick={() => setShowPlanModal(false)}>关闭</button>
            </div>
            {creationMode === "plan" && (
              <>
                <label className="featured-task-field">教学任务<input value={planDraft.lesson_title} onChange={(event) => setPlanDraft({ ...planDraft, lesson_title: event.target.value })} placeholder="课题 / 内容" autoFocus /></label>
                <label>日期<input value={planDraft.plan_date} onChange={(event) => setPlanDraft({ ...planDraft, plan_date: event.target.value })} type="date" /></label>
                <label>班级<select value={planDraft.class_name || ""} onChange={(event) => setPlanDraft({ ...planDraft, class_name: event.target.value })}>
                  <option value="">5班、6班同步</option>
                  {data.appConfig.teachingClasses.map((className) => <option key={className} value={className}>{className}</option>)}
                </select></label>
                <label>任务标签<select value={planDraft.lesson_type || "新授课"} onChange={(event) => setPlanDraft({ ...planDraft, lesson_type: event.target.value })}>
                  <option>新授课</option>
                  <option>复习课</option>
                  <option>学科测试</option>
                  <option>其他</option>
                </select></label>
                <label>内容<textarea value={planDraft.lesson_goal} onChange={(event) => setPlanDraft({ ...planDraft, lesson_goal: event.target.value })} rows="3" /></label>
                <label>资料<input value={planDraft.resources} onChange={(event) => setPlanDraft({ ...planDraft, resources: event.target.value })} placeholder="课件、导学单、文本等" /></label>
                <label>补充说明<textarea value={planDraft.note} onChange={(event) => setPlanDraft({ ...planDraft, note: event.target.value })} rows="2" /></label>
              </>
            )}
            {creationMode === "homework" && (
              <>
                <label>时间段<DateRangeField start={linkedHomework.assign_date} end={linkedHomework.due_date} onChange={({ start, end }) => setLinkedHomework({ ...linkedHomework, assign_date: start, due_date: end })} /></label>
                <label>作业类型<select value={linkedHomework.homework_type || "日常作业"} onChange={(event) => setLinkedHomework({ ...linkedHomework, homework_type: event.target.value })}><option>日常作业</option><option>周期作业</option></select></label>
                <label>班级范围<select value={linkedHomework.class_name || ""} onChange={(event) => setLinkedHomework({ ...linkedHomework, class_name: event.target.value })}>
                  <option value="">5班、6班同步</option>
                  {data.appConfig.teachingClasses.map((className) => <option key={className} value={className}>{className}</option>)}
                </select></label>
                <label>作业名称<input value={linkedHomework.title} onChange={(event) => setLinkedHomework({ ...linkedHomework, title: event.target.value })} placeholder="作业项目" autoFocus /></label>
                <label>备注<textarea value={linkedHomework.note} onChange={(event) => setLinkedHomework({ ...linkedHomework, note: event.target.value })} rows="3" /></label>
              </>
            )}
            {creationMode === "recitation" && (
              <>
                <label>时间段<DateRangeField start={linkedRecitation.assign_date} end={linkedRecitation.due_date} onChange={({ start, end }) => setLinkedRecitation({ ...linkedRecitation, assign_date: start, due_date: end })} /></label>
                <label>背默类型<select value={linkedRecitation.recitation_type || "背诵"} onChange={(event) => setLinkedRecitation({ ...linkedRecitation, recitation_type: event.target.value })}><option>背诵</option><option>默写</option><option>背默</option></select></label>
                <label>班级范围<select value={linkedRecitation.class_name || ""} onChange={(event) => setLinkedRecitation({ ...linkedRecitation, class_name: event.target.value })}>
                  <option value="">5班、6班同步</option>
                  {data.appConfig.teachingClasses.map((className) => <option key={className} value={className}>{className}</option>)}
                </select></label>
                <label>篇目 / 任务<input value={linkedRecitation.title} onChange={(event) => setLinkedRecitation({ ...linkedRecitation, title: event.target.value })} placeholder="背默篇目" autoFocus /></label>
                <label>内容范围<textarea value={linkedRecitation.content} onChange={(event) => setLinkedRecitation({ ...linkedRecitation, content: event.target.value })} rows="3" /></label>
                <label>备注<input value={linkedRecitation.note} onChange={(event) => setLinkedRecitation({ ...linkedRecitation, note: event.target.value })} /></label>
              </>
            )}
            {editingTask && <button type="button" className="danger-button" onClick={deleteEditingTask}>删除{creationMode === "homework" ? "作业" : creationMode === "recitation" ? "背默" : "教学任务"}</button>}
            <button type="submit"><Save size={16} />保存{creationMode === "homework" ? "作业" : creationMode === "recitation" ? "背默" : "教学任务"}</button>
          </form>
        </div>
      )}
      {metricDetail && (
        <QuickDetailModal
          title={`${metricDetail}速览`}
          subtitle={`${teachingClass} · 默认显示本周相关事项`}
          items={subjectMetricDetails[metricDetail]}
          onClose={() => setMetricDetail(null)}
        />
      )}
    </section>
  );
}

function buildAssessmentItems(data) {
  const plannedTests = (data.subject?.plans || [])
    .filter((plan) => plan.lesson_type === "学科测试")
    .filter((plan) => !(data.subject?.assessments || []).some((test) =>
      test.title === plan.lesson_title && test.test_date === plan.plan_date && (test.class_name || "") === (plan.class_name || "")
    ))
    .map((plan) => ({
      id: `plan-${plan.id}`,
      source: "plan",
      title: plan.lesson_title,
      subject: plan.subject,
      class_name: plan.class_name || "",
      test_type: "学科测试",
      test_date: plan.plan_date,
      excellent_score: 90,
      pass_score: 60,
      paper_path: plan.resources || "",
      note: plan.note || plan.lesson_goal || "",
      score_columns: []
    }));
  return [...plannedTests, ...(data.subject?.assessments || []).map((item) => ({ score_columns: [], ...item, source: "assessment" }))].sort((a, b) => (b.test_date || "").localeCompare(a.test_date || ""));
}

function assessmentStats(test, className, data) {
  const students = data.students.filter((student) => student.class_name === className);
  const scores = (data.subject?.assessmentScores || []).filter((score) => String(score.test_id) === String(test.id) && score.class_name === className && score.score !== "" && score.score !== null && score.score !== undefined);
  const values = scores.map((score) => Number(score.score)).filter((score) => !Number.isNaN(score));
  const avg = values.length ? (values.reduce((sum, score) => sum + score, 0) / values.length).toFixed(1) : "-";
  const excellentLine = Number(test.excellent_score || 90);
  const passLine = Number(test.pass_score || 60);
  const excellentRate = values.length ? `${Math.round(values.filter((score) => score >= excellentLine).length / students.length * 100)}%` : "-";
  const passRate = values.length ? `${Math.round(values.filter((score) => score >= passLine).length / students.length * 100)}%` : "-";
  return { avg, excellentRate, passRate, count: values.length, total: students.length };
}

function assessmentStatsForGroup(test, className, data) {
  const sourceTests = test.sourceTests?.length ? test.sourceTests : [test];
  const applicable = sourceTests.filter((item) => !item.class_name || item.class_name === className);
  return assessmentStats(applicable[0] || test, className, data);
}

function TaskOverviewPage({ data, taskKind, tasks, setTeachingClass, addTask, updateTask, deleteTask }) {
  const isRecitation = taskKind === "recitation";
  const [dateRange, setDateRange] = useState(defaultWeekRange());
  const [editingTask, setEditingTask] = useState(null);
  const [draft, setDraft] = useState({
    title: "",
    subject: data.appConfig.subject || "语文",
    class_name: "",
    homework_type: "日常作业",
    recitation_type: "背诵",
    assign_date: todayIso(),
    due_date: todayIso(),
    content: "",
    note: ""
  });
  const rangeDays = buildAlignedDateRangeDays(dateRange.start, dateRange.end);
  const visibleTasks = tasks.filter((task) => {
    const taskDate = task.assign_date || task.due_date || "";
    return taskDate >= dateRange.start && taskDate <= dateRange.end;
  });
  const mergedTasks = Object.values(visibleTasks.reduce((acc, task) => {
    const key = [task.assign_date || task.due_date || "", task.due_date || "", task.title || "", task.homework_type || task.recitation_type || ""].join("|");
    acc[key] = acc[key] || { ...task, mergedIds: [], classNames: [], sourceTasks: [] };
    acc[key].mergedIds.push(task.id);
    acc[key].sourceTasks.push(task);
    if (task.class_name) acc[key].classNames.push(task.class_name);
    return acc;
  }, {})).map((task) => ({
    ...task,
    classLabel: task.class_name ? Array.from(new Set(task.classNames)).join("、") : "5班、6班同步"
  }));

  async function submitTask(event) {
    event.preventDefault();
    const payload = editingTask ? { ...editingTask, ...draft } : draft;
    if (!payload.title?.trim()) return;
    if (editingTask) await updateTask(payload, payload);
    else await addTask(payload);
    setEditingTask(null);
    setDraft((current) => ({ ...current, title: "", class_name: "", content: "", note: "" }));
  }

  function openTask(task) {
    setEditingTask(task);
    setDraft({
      title: task.title || "",
      subject: task.subject || data.appConfig.subject || "语文",
      class_name: task.class_name || "",
      homework_type: task.homework_type || "日常作业",
      recitation_type: task.recitation_type || "背诵",
      assign_date: task.assign_date || todayIso(),
      due_date: task.due_date || task.assign_date || todayIso(),
      content: task.content || "",
      note: task.note || ""
    });
  }

  async function removeTask() {
    if (!editingTask) return;
    await deleteTask(editingTask);
    setEditingTask(null);
    setDraft((current) => ({ ...current, title: "", class_name: "", content: "", note: "" }));
  }

  return (
    <section className="subject-page">
      <section className="panel subject-plan-panel">
        <div className="panel-title">
          <div>
            <h2>{isRecitation ? "背默管理" : "作业管理"}</h2>
            <span>二级总览页，日历内可直接新增、修改、删除，并同步到 5班/6班登记页</span>
          </div>
          <div className="task-range-toolbar">
            <DateRangeField start={dateRange.start} end={dateRange.end} onChange={setDateRange} />
            <button type="button" className="subtle-button" onClick={() => setDateRange(defaultWeekRange())}>本周</button>
          </div>
        </div>
        <form className="overview-task-form" onSubmit={submitTask}>
          <DateRangeField start={draft.assign_date} end={draft.due_date} onChange={({ start, end }) => setDraft({ ...draft, assign_date: start, due_date: end })} />
          <select value={isRecitation ? draft.recitation_type : draft.homework_type} onChange={(event) => setDraft(isRecitation ? { ...draft, recitation_type: event.target.value } : { ...draft, homework_type: event.target.value })}>
            {isRecitation ? <><option>背诵</option><option>默写</option><option>背默</option></> : <><option>日常作业</option><option>周期作业</option></>}
          </select>
          <select value={draft.class_name || ""} onChange={(event) => setDraft({ ...draft, class_name: event.target.value })}>
            <option value="">5班、6班同步</option>
            {data.appConfig.teachingClasses.map((className) => <option key={className}>{className}</option>)}
          </select>
          <input className="wide-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={isRecitation ? "背默篇目" : "作业名称"} />
          <button type="submit"><Save size={15} />{editingTask ? "保存修改" : "新增"}</button>
          {editingTask && <button type="button" className="danger-button" onClick={removeTask}>删除</button>}
        </form>
        <div className="month-grid task-overview-month">
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => <b className="month-weekday" key={day}>周{day}</b>)}
          {rangeDays.map((day) => {
            if (day.isBlank) return <div className="month-day is-range-blank" key={day.iso} />;
            const dayTasks = mergedTasks.filter((task) => task.assign_date === day.iso);
            return (
              <div className={`month-day ${day.iso >= defaultWeekRange().start && day.iso <= defaultWeekRange().end ? "is-current-week" : ""}`} key={day.iso} onDoubleClick={() => setDraft((current) => ({ ...current, assign_date: day.iso, due_date: day.iso }))}>
                <span className="month-date">{day.day}</span>
                <i>{day.weekday}</i>
                <div className="day-task-lanes">
                  {dayTasks.map((task) => (
                    <button className={`calendar-chip ${isRecitation ? "recitation" : "homework"}`} type="button" key={task.id} onClick={() => openTask(task)}>
                      {isRecitation ? "背默" : "作业"} · {task.title}
                    </button>
                  ))}
                  {!dayTasks.length && <button className={`calendar-chip ${isRecitation ? "recitation" : "homework"} is-placeholder`} type="button" onClick={() => setDraft((current) => ({ ...current, assign_date: day.iso, due_date: day.iso }))}>+{isRecitation ? "背默" : "作业"}</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="task-project-table">
          <div className="task-project-head"><b>日期</b><b>名称</b><b>班级</b><b>类型</b><b>备注</b><b>操作</b></div>
          {mergedTasks.map((task) => (
            <div className="task-project-row compact" key={task.id}>
              <span>{task.assign_date}</span><b>{task.title}</b><span>{task.classLabel}</span><span>{task.homework_type || task.recitation_type}</span><span>{task.note || "-"}</span>
              <button type="button" className="subtle-button" onClick={() => openTask(task)}>修改</button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function AssessmentOverviewPage({ data, draft, setDraft, addAssessment, updateAssessment, deleteAssessment, setTeachingClass, setActiveTeachingPage }) {
  const tests = buildAssessmentItems(data);
  const [editing, setEditing] = useState(null);
  const [typeFilter, setTypeFilter] = useState("全部");

  const filtered = tests.filter((test) => typeFilter === "全部" || test.test_type === typeFilter);
  const mergedTests = Object.values(filtered.reduce((acc, test) => {
    const key = [test.test_date || "", test.title || "", test.test_type || ""].join("|");
    acc[key] = acc[key] || { ...test, sourceTests: [], classNames: [] };
    acc[key].sourceTests.push(test);
    if (test.class_name) acc[key].classNames.push(test.class_name);
    return acc;
  }, {}));
  function startEdit(test) {
    if (test.source === "plan") return;
    setEditing(test);
    setDraft({ ...test });
  }
  async function submit(event) {
    event.preventDefault();
    if (editing) await updateAssessment({ ...editing, ...draft });
    else await addAssessment(event, draft);
    setEditing(null);
  }
  async function remove() {
    if (!editing) return;
    await deleteAssessment(editing);
    setEditing(null);
  }

  return (
    <section className="subject-page">
      <section className="panel">
        <div className="panel-title">
          <div><h2>测评管理</h2><span>汇总两个班级测评，支持上传试卷、设置优秀线和及格线</span></div>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>全部</option><option>单元测评</option><option>阶段测试</option><option>学科测试</option><option>其他</option></select>
        </div>
        <AssessmentForm draft={draft} setDraft={setDraft} editing={editing} onSubmit={submit} onDelete={remove} />
        <div className="assessment-table">
          <div className="assessment-head"><b>日期</b><b>测评</b><b>类型</b><b>试卷</b><b>5班</b><b>6班</b><b>操作</b></div>
          {mergedTests.map((test) => (
            <div className="assessment-row" key={test.id}>
              <span>{test.test_date}</span>
              <b>{test.title}</b>
              <span>{test.test_type}</span>
              <span>{test.paper_path ? "已上传" : "-"}</span>
              {data.appConfig.teachingClasses.map((className) => {
                const stats = assessmentStatsForGroup(test, className, data);
                return (
                  <button type="button" key={className} onClick={() => { setTeachingClass(className); setActiveTeachingPage(`assessment-${className}`); }}>
                    {className.replace("预备", "")}：均 {stats.avg} · 优 {stats.excellentRate} · 及 {stats.passRate}
                  </button>
                );
              })}
              <button type="button" className="subtle-button" disabled={test.source === "plan"} onClick={() => startEdit(test)}>{test.source === "plan" ? "来自规划" : "修改"}</button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function AssessmentForm({ draft, setDraft, editing, onSubmit, onDelete }) {
  return (
    <form className="assessment-form" onSubmit={onSubmit}>
      <input type="date" value={draft.test_date} onChange={(event) => setDraft({ ...draft, test_date: event.target.value })} />
      <select value={draft.test_type || "单元测评"} onChange={(event) => setDraft({ ...draft, test_type: event.target.value })}><option>单元测评</option><option>阶段测试</option><option>学科测试</option><option>其他</option></select>
      <select value={draft.class_name || ""} onChange={(event) => setDraft({ ...draft, class_name: event.target.value })}><option value="">5班、6班同步</option><option>预备5班</option><option>预备6班</option></select>
      <input className="wide-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="测评名称" />
      <label>优秀线<input type="number" value={draft.excellent_score} onChange={(event) => setDraft({ ...draft, excellent_score: event.target.value })} /></label>
      <label>及格线<input type="number" value={draft.pass_score} onChange={(event) => setDraft({ ...draft, pass_score: event.target.value })} /></label>
      <label className="file-input-label"><Upload size={14} />上传试卷<input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setDraft({ ...draft, paper_path: event.target.files?.[0]?.path || event.target.files?.[0]?.name || "" })} /></label>
      <button type="submit"><Save size={15} />{editing ? "保存" : "新增考试"}</button>
      {editing && <button type="button" className="danger-button" onClick={onDelete}>删除</button>}
    </form>
  );
}

function AssessmentManagementPage({ data, className, addAssessment, updateAssessment, deleteAssessment, setAssessmentScore }) {
  const tests = buildAssessmentItems(data).filter((test) => !test.class_name || test.class_name === className);
  const sortedTests = [...tests].sort((a, b) => (a.test_date || "").localeCompare(b.test_date || ""));
  const students = [...data.students.filter((student) => student.class_name === className)].sort((a, b) => Number(a.student_no || 0) - Number(b.student_no || 0));
  const scores = data.subject.assessmentScores || [];
  const [modal, setModal] = useState(null);

  function openCreate() {
    setModal({ mode: "create" });
  }

  function openEdit(test) {
    setModal({ mode: "edit", test });
  }

  async function removeTest(test) {
    if (test.source === "plan") return;
    if (!window.confirm(`确定删除「${test.title}」这次测评及本班已录入的成绩吗？`)) return;
    await deleteAssessment(test);
    setModal(null);
  }

  const historyGridStyle = { gridTemplateColumns: `70px minmax(84px, .8fr) repeat(${sortedTests.length}, minmax(104px, 1fr))` };

  return (
    <section className="subject-page">
      <section className="panel">
        <div className="panel-title">
          <div><h2>{className}测评管理</h2><span>默认展示历次成绩，点击"新增测评"弹窗录入本班分数</span></div>
          <button type="button" className="small-primary-button" onClick={openCreate}><Plus size={15} />新增测评</button>
        </div>
        {!sortedTests.length ? (
          <div className="empty-row">暂无测评记录，点击右上角"新增测评"开始录入本班成绩。</div>
        ) : (
          <div className="assessment-history-wrap">
            <div className="assessment-history-row assessment-history-head" style={historyGridStyle}>
              <b>学号</b><b>姓名</b>
              {sortedTests.map((test) => {
                const stats = assessmentStats(test, className, data);
                return (
                  <button type="button" className="assessment-history-col-btn" key={test.id} onClick={() => openEdit(test)} title="点击查看/修改本次测评成绩">
                    <strong>{test.title}</strong>
                    <small>{test.test_date}</small>
                    <small>均{stats.avg} 及{stats.passRate}</small>
                  </button>
                );
              })}
            </div>
            {students.map((student) => (
              <div className="assessment-history-row" style={historyGridStyle} key={student.id}>
                <span>{student.student_no || "-"}</span><b>{student.name}</b>
                {sortedTests.map((test) => {
                  const saved = scores.find((score) => String(score.test_id) === String(test.id) && String(score.student_id) === String(student.id) && score.class_name === className);
                  const value = saved?.score ?? "";
                  const hasValue = value !== "" && value !== null && value !== undefined;
                  const status = !hasValue ? "" : Number(value) >= Number(test.excellent_score || 90) ? "is-excellent" : Number(value) >= Number(test.pass_score || 60) ? "is-pass" : "is-behind";
                  return <span className={`assessment-history-cell ${status}`} key={test.id}>{hasValue ? value : "-"}</span>;
                })}
              </div>
            ))}
          </div>
        )}
      </section>
      {modal && (
        <AssessmentEntryModal
          key={modal.test?.id || "create"}
          test={modal.test || null}
          className={className}
          students={students}
          scores={scores}
          existingIds={new Set((data.subject.assessments || []).map((item) => String(item.id)))}
          addAssessment={addAssessment}
          updateAssessment={updateAssessment}
          setAssessmentScore={setAssessmentScore}
          onDelete={modal.test && modal.test.source !== "plan" ? () => removeTest(modal.test) : null}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}

function AssessmentEntryModal({ test, className, students, scores, existingIds, addAssessment, updateAssessment, setAssessmentScore, onDelete, onClose }) {
  const [form, setForm] = useState(() => ({
    title: test?.title || "",
    test_date: test?.test_date || todayIso(),
    test_type: test?.test_type || "单元测评",
    excellent_score: test?.excellent_score ?? 90,
    pass_score: test?.pass_score ?? 60,
    paper_path: test?.paper_path || ""
  }));
  const [scoreColumns, setScoreColumns] = useState(() => (Array.isArray(test?.score_columns) ? [...test.score_columns] : []));
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [rows, setRows] = useState(() => {
    const initial = {};
    for (const student of students) {
      const saved = test ? scores.find((score) => String(score.test_id) === String(test.id) && String(score.student_id) === String(student.id) && score.class_name === className) : null;
      initial[student.id] = {
        breakdown: saved?.breakdown ? { ...saved.breakdown } : {},
        total: saved?.score === null || saved?.score === undefined ? "" : String(saved.score)
      };
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const cellRefs = useRef({});
  const readOnlyLocked = test && test.source === "plan";

  const columnCount = scoreColumns.length + 1;

  function focusCell(rowIndex, colIndex) {
    const target = cellRefs.current[`${rowIndex}-${colIndex}`];
    if (target) {
      target.focus();
      target.select?.();
    }
  }

  function handleGridKeyDown(event, rowIndex, colIndex) {
    if (event.key === "ArrowUp") { event.preventDefault(); focusCell(rowIndex - 1, colIndex); }
    else if (event.key === "ArrowDown") { event.preventDefault(); focusCell(rowIndex + 1, colIndex); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); focusCell(rowIndex, colIndex - 1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); focusCell(rowIndex, colIndex + 1); }
  }

  function addColumn() {
    const label = newColumnLabel.trim();
    if (!label || scoreColumns.includes(label)) { setNewColumnLabel(""); return; }
    setScoreColumns((current) => [...current, label]);
    setNewColumnLabel("");
  }

  function removeColumn(label) {
    setScoreColumns((current) => current.filter((item) => item !== label));
  }

  function updateBreakdown(studentId, column, value) {
    setRows((current) => {
      const row = current[studentId] || { breakdown: {}, total: "" };
      const breakdown = { ...row.breakdown, [column]: value };
      const sum = scoreColumns.reduce((total, col) => total + (Number(breakdown[col]) || 0), 0);
      return { ...current, [studentId]: { breakdown, total: String(sum) } };
    });
  }

  function updateTotal(studentId, value) {
    setRows((current) => ({ ...current, [studentId]: { ...(current[studentId] || { breakdown: {} }), total: value } }));
  }

  const liveTotals = students
    .map((student) => rows[student.id]?.total)
    .filter((value) => value !== "" && value !== undefined && value !== null)
    .map(Number)
    .filter((value) => !Number.isNaN(value));
  const liveAvg = liveTotals.length ? (liveTotals.reduce((sum, value) => sum + value, 0) / liveTotals.length).toFixed(1) : "-";
  const liveExcellentRate = liveTotals.length ? `${Math.round(liveTotals.filter((value) => value >= Number(form.excellent_score || 90)).length / students.length * 100)}%` : "-";
  const livePassRate = liveTotals.length ? `${Math.round(liveTotals.filter((value) => value >= Number(form.pass_score || 60)).length / students.length * 100)}%` : "-";

  async function handleSave(event) {
    event.preventDefault();
    if (!form.title.trim() || !form.test_date) { window.alert("请填写测评名称和日期。"); return; }
    setSaving(true);
    try {
      let targetTest = test;
      const payload = { ...form, class_name: className, score_columns: scoreColumns };
      if (targetTest && targetTest.source !== "plan") {
        await updateAssessment({ ...targetTest, ...payload, id: targetTest.id });
      } else if (!targetTest) {
        const updated = await addAssessment(null, payload);
        targetTest = (updated?.subject?.assessments || []).find((item) => !existingIds.has(String(item.id))) || null;
      }
      if (targetTest) {
        for (const student of students) {
          const row = rows[student.id] || { breakdown: {}, total: "" };
          const total = row.total === "" ? "" : Number(row.total);
          await setAssessmentScore({ test_id: targetTest.id, student_id: student.id, class_name, score: total === "" || Number.isNaN(total) ? "" : total, breakdown: row.breakdown || {}, note: "" });
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop work-area-backdrop">
      <form className="cell-editor score-entry-modal assessment-entry-modal" onSubmit={handleSave}>
        <div className="panel-title">
          <div>
            <h2>{test ? "修改测评成绩" : "新增测评并录入成绩"}</h2>
            <span>{className} · 总分可直接填写，添加小分项后自动求和{readOnlyLocked ? "（本次来自教学规划，测评信息不可修改，仅可录入成绩）" : ""}</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="assessment-entry-meta">
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="测评名称" disabled={readOnlyLocked} />
          <input type="date" value={form.test_date} onChange={(event) => setForm({ ...form, test_date: event.target.value })} disabled={readOnlyLocked} />
          <select value={form.test_type} onChange={(event) => setForm({ ...form, test_type: event.target.value })} disabled={readOnlyLocked}>
            <option>单元测评</option><option>阶段测试</option><option>学科测试</option><option>其他</option>
          </select>
          <label>优秀线<input type="number" value={form.excellent_score} onChange={(event) => setForm({ ...form, excellent_score: event.target.value })} disabled={readOnlyLocked} /></label>
          <label>及格线<input type="number" value={form.pass_score} onChange={(event) => setForm({ ...form, pass_score: event.target.value })} disabled={readOnlyLocked} /></label>
          <label className="file-input-label"><Upload size={14} />上传试卷<input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(event) => setForm({ ...form, paper_path: event.target.files?.[0]?.path || event.target.files?.[0]?.name || "" })} disabled={readOnlyLocked} /></label>
        </div>

        <div className="assessment-entry-columns">
          <span>小分项：</span>
          {scoreColumns.map((column) => (
            <span className="assessment-entry-column-chip" key={column}>
              {column}
              <button type="button" onClick={() => removeColumn(column)}><X size={11} /></button>
            </span>
          ))}
          <span className="assessment-entry-add-column">
            <input value={newColumnLabel} onChange={(event) => setNewColumnLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addColumn(); } }} placeholder="如：阅读题" />
            <button type="button" onClick={addColumn}><Plus size={12} />添加小分项</button>
          </span>
        </div>

        <div className="assessment-entry-grid-wrap">
          <div className="assessment-entry-row assessment-entry-head" style={{ gridTemplateColumns: `64px minmax(70px, .8fr) repeat(${columnCount}, minmax(76px, 1fr))` }}>
            <b>学号</b><b>姓名</b>
            {scoreColumns.map((column) => <b key={column}>{column}</b>)}
            <b>总分</b>
          </div>
          {students.map((student, rowIndex) => {
            const row = rows[student.id] || { breakdown: {}, total: "" };
            return (
              <div className="assessment-entry-row" style={{ gridTemplateColumns: `64px minmax(70px, .8fr) repeat(${columnCount}, minmax(76px, 1fr))` }} key={student.id}>
                <span>{student.student_no || "-"}</span><b>{student.name}</b>
                {scoreColumns.map((column, colIndex) => (
                  <span key={column}>
                    <input
                      type="number"
                      value={row.breakdown?.[column] ?? ""}
                      ref={(element) => { cellRefs.current[`${rowIndex}-${colIndex}`] = element; }}
                      onKeyDown={(event) => handleGridKeyDown(event, rowIndex, colIndex)}
                      onChange={(event) => updateBreakdown(student.id, column, event.target.value)}
                    />
                  </span>
                ))}
                <span className="assessment-entry-total-cell">
                  <input
                    type="number"
                    value={row.total}
                    readOnly={scoreColumns.length > 0}
                    ref={(element) => { cellRefs.current[`${rowIndex}-${scoreColumns.length}`] = element; }}
                    onKeyDown={(event) => handleGridKeyDown(event, rowIndex, scoreColumns.length)}
                    onChange={(event) => updateTotal(student.id, event.target.value)}
                  />
                </span>
              </div>
            );
          })}
        </div>

        <div className="assessment-entry-stats">
          <span>平均分 <b>{liveAvg}</b></span>
          <span>优秀率 <b>{liveExcellentRate}</b></span>
          <span>及格率 <b>{livePassRate}</b></span>
        </div>

        <div className="modal-actions">
          {onDelete && <button type="button" className="danger-button" onClick={onDelete}>删除本次测评</button>}
          <button type="submit" disabled={saving}><Save size={16} />{saving ? "保存中…" : "保存成绩"}</button>
        </div>
      </form>
    </div>
  );
}

function TaskManagementPage({ data, className, taskKind, draft, setDraft, addTask, updateTask, deleteTask, setTaskStudentStatus }) {
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("student_no");
  const [viewMode, setViewMode] = useState("calendar");
  const [dateRange, setDateRange] = useState(defaultWeekRange());
  const [editingTask, setEditingTask] = useState(null);
  const [studentDetail, setStudentDetail] = useState(null);
  const students = data.students.filter((student) => student.class_name === className);
  const rawTasks = taskKind === "recitation" ? (data.subject.recitations || []) : data.subject.homework;
  const tasks = rawTasks.filter((task) => !task.class_name || task.class_name === className).sort((a, b) => (a.assign_date || "").localeCompare(b.assign_date || ""));
  const visibleTasks = tasks.filter((task) => {
    const taskDate = task.assign_date || task.due_date || "";
    return taskDate >= dateRange.start && taskDate <= dateRange.end;
  });
  const statuses = (data.subject.taskStatuses || []).filter((status) => status.class_name === className && status.task_kind === taskKind);
  const selectedTask = tasks.find((task) => String(task.id) === String(selectedTaskId)) || tasks[0];
  const isRecitation = taskKind === "recitation";
  const weekStart = mondayOfWeek(todayIso());
  const calendarDays = buildDateRangeDays(dateRange.start, dateRange.end).map((day) => day.iso).filter((dateValue) => dateFromIso(dateValue).getDay() >= 1 && dateFromIso(dateValue).getDay() <= 5);

  const taskRows = visibleTasks.map((task) => {
    const taskStatuses = statuses.filter((status) => String(status.task_id) === String(task.id));
    const doneIds = new Set(taskStatuses.filter((status) => status.is_done).map((status) => String(status.student_id)));
    const praiseIds = new Set(taskStatuses.filter((status) => status.praise).map((status) => String(status.student_id)));
    const improveIds = new Set(taskStatuses.filter((status) => status.needs_improvement).map((status) => String(status.student_id)));
    return {
      task,
      done: doneIds.size,
      praiseNames: students.filter((student) => praiseIds.has(String(student.id))).map((student) => student.name),
      improveNames: students.filter((student) => improveIds.has(String(student.id))).map((student) => student.name),
      pendingNames: students.filter((student) => !doneIds.has(String(student.id))).map((student) => student.name)
    };
  });

  const studentRows = students.map((student) => {
    const status = selectedTask ? statuses.find((item) => String(item.task_id) === String(selectedTask.id) && String(item.student_id) === String(student.id)) : null;
    return {
      student,
      is_done: Boolean(status?.is_done),
      praise: Boolean(status?.praise),
      needs_improvement: Boolean(status?.needs_improvement),
      note: status?.note || ""
    };
  }).filter((row) => {
    if (statusFilter === "done") return row.is_done;
    if (statusFilter === "pending") return !row.is_done;
    if (statusFilter === "praise") return row.praise;
    if (statusFilter === "improve") return row.needs_improvement;
    return true;
  }).sort((a, b) => {
    if (sortKey === "status") return Number(a.is_done) - Number(b.is_done);
    if (sortKey === "name") return a.student.name.localeCompare(b.student.name, "zh-Hans-CN");
    return Number(a.student.student_no || 0) - Number(b.student.student_no || 0);
  });

  function statusFor(task, student) {
    return statuses.find((item) => String(item.task_id) === String(task.id) && String(item.student_id) === String(student.id));
  }

  async function saveStatus(student, changes) {
    if (!selectedTask) return;
    const current = statusFor(selectedTask, student) || {};
    await setTaskStudentStatus({
      task_kind: taskKind,
      task_id: selectedTask.id,
      student_id: student.id,
      class_name: className,
      is_done: changes.is_done ?? Boolean(current.is_done),
      praise: changes.praise ?? Boolean(current.praise),
      needs_improvement: changes.needs_improvement ?? Boolean(current.needs_improvement),
      note: changes.note ?? current.note ?? ""
    });
  }

  async function clearStatus(student) {
    await saveStatus(student, { is_done: false, praise: false, needs_improvement: false, note: "" });
  }

  async function markAllDone() {
    if (!selectedTask) return;
    for (const student of students) {
      await setTaskStudentStatus({
        task_kind: taskKind,
        task_id: selectedTask.id,
        student_id: student.id,
        class_name: className,
        is_done: true,
        praise: Boolean(statusFor(selectedTask, student)?.praise),
        needs_improvement: Boolean(statusFor(selectedTask, student)?.needs_improvement),
        note: statusFor(selectedTask, student)?.note || ""
      });
    }
  }

  async function toggleColumnAll(field) {
    if (!selectedTask || !studentRows.length) return;
    const shouldCheck = !studentRows.every((row) => row[field]);
    for (const row of studentRows) {
      await saveStatus(row.student, { [field]: shouldCheck });
    }
  }

  function openEditTask(task) {
    setEditingTask({ ...task });
  }

  async function saveEditedTask(event) {
    event.preventDefault();
    await updateTask(editingTask, editingTask);
    setEditingTask(null);
  }

  async function removeEditedTask() {
    await deleteTask(editingTask);
    setEditingTask(null);
  }

  async function exportRows() {
    const result = await appApi.exportTaskStudentStatus({ className, taskKind, taskId: selectedTask?.id || "all" });
    if (result?.canceled) window.alert("已取消导出。");
    else window.alert(result?.filePath ? `已导出：${result.filePath}` : "已完成导出。");
  }

  const groupedTasks = visibleTasks.reduce((groups, task) => {
    const date = task.assign_date || task.due_date || "";
    groups[date] = groups[date] || [];
    groups[date].push(task);
    return groups;
  }, {});

  return (
    <section className="subject-page task-management-page">
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>{className}{isRecitation ? "背默管理" : "作业管理"}</h2>
            <span>任务栏支持日历视图和列表视图，修改与删除同步到教学规划页</span>
          </div>
          <button type="button" className="small-primary-button" onClick={exportRows}><Download size={15} />按条件导出</button>
        </div>

        <div className="task-view-toolbar">
          <div className="segmented-control">
            <button type="button" className={viewMode === "calendar" ? "is-active" : ""} onClick={() => setViewMode("calendar")}>日历视图</button>
            <button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>列表视图</button>
          </div>
          <div className="task-range-toolbar">
            <DateRangeField start={dateRange.start} end={dateRange.end} onChange={setDateRange} />
            <button type="button" className="subtle-button" onClick={() => setDateRange(defaultWeekRange())}>本周</button>
          </div>
        </div>

        {draft && setDraft && addTask && (
          <form className="recitation-form" onSubmit={addTask}>
            <input value={draft.title} onDoubleClick={(event) => event.currentTarget.select()} onChange={(event) => setDraft({ ...draft, title: event.target.value, class_name: className })} placeholder={isRecitation ? "篇目，双击可快速选中添加" : "作业名称，双击可快速选中添加"} />
            <select value={isRecitation ? draft.recitation_type : draft.homework_type} onChange={(event) => setDraft(isRecitation ? { ...draft, recitation_type: event.target.value, class_name: className } : { ...draft, homework_type: event.target.value, class_name: className })}>
              {isRecitation ? <><option>背诵</option><option>默写</option><option>背默</option></> : <><option>日常作业</option><option>周期作业</option></>}
            </select>
            <DateRangeField start={draft.assign_date} end={draft.due_date} onChange={({ start, end }) => setDraft({ ...draft, assign_date: start, due_date: end, class_name: className })} />
            <input value={isRecitation ? draft.content : draft.note} onChange={(event) => setDraft(isRecitation ? { ...draft, content: event.target.value, class_name: className } : { ...draft, note: event.target.value, class_name: className })} placeholder={isRecitation ? "范围 / 要求" : "要求 / 备注"} />
            <button type="submit"><Plus size={16} />新增{isRecitation ? "背默" : "作业"}</button>
          </form>
        )}

        {viewMode === "calendar" ? (
          <div className="task-week-calendar">
            {calendarDays.map((dateValue) => {
              const dayTasks = visibleTasks.filter((task) => task.assign_date === dateValue);
              return (
                <article className={`task-day-card ${dateValue >= weekStart && dateValue <= addDays(weekStart, 4) ? "is-current-week" : ""}`} key={dateValue}>
                  <b>{dateValue}</b>
                  <span>{weekdayLabel(dateValue)}</span>
                  {dayTasks.map((task) => (
                    <button type="button" className={isRecitation ? "recitation-task-chip" : "homework-task-chip"} key={task.id} onClick={() => setSelectedTaskId(String(task.id))} onDoubleClick={() => openEditTask(task)}>
                      {task.title}
                    </button>
                  ))}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="task-date-list">
            {Object.entries(groupedTasks).map(([dateValue, dateTasks]) => (
              <article key={dateValue}>
                <h3>{dateValue} {weekdayLabel(dateValue)}</h3>
                {dateTasks.map((task) => <button type="button" key={task.id} onClick={() => setSelectedTaskId(String(task.id))} onDoubleClick={() => openEditTask(task)}>{task.title}<small>{task.homework_type || task.recitation_type}</small></button>)}
              </article>
            ))}
          </div>
        )}

        <div className="task-project-table">
          <div className="task-project-head">
            <b>日期</b><b>{isRecitation ? "篇目" : "作业名称"}</b><b>班级</b><b>类型</b><b>统计数据</b><b>表扬名单</b><b>待完成名单</b><b>操作</b>
          </div>
          {taskRows.map(({ task, done, praiseNames, pendingNames }) => (
            <div className="task-project-row" key={task.id} onDoubleClick={() => openEditTask(task)}>
              <span>{task.assign_date}</span>
              <b>{task.title}</b>
              <span>{task.class_name || "5班、6班同步"}</span>
              <span>{task.homework_type || task.recitation_type || "日常作业"}</span>
              <span>{done}/{students.length} 完成</span>
              <span>{praiseNames.join("、") || "-"}</span>
              <span>{pendingNames.slice(0, 8).join("、") || "无"}{pendingNames.length > 8 ? `等${pendingNames.length}人` : ""}</span>
              <button type="button" className="subtle-button" onClick={(event) => { event.stopPropagation(); openEditTask(task); }}>修改</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>{isRecitation ? "背默登记" : "作业批改登记"}</h2>
            <span>{selectedTask ? `${selectedTask.assign_date} · ${selectedTask.title}` : "请先建立任务"}</span>
          </div>
          <button type="button" className="small-primary-button" onClick={markAllDone}>一键全勾完成</button>
        </div>
        <div className="task-filter-bar">
          <label>任务<select value={selectedTask?.id || ""} onChange={(event) => setSelectedTaskId(event.target.value)}>
            {tasks.map((task) => <option value={task.id} key={task.id}>{task.assign_date} · {task.title}</option>)}
          </select></label>
          <label>筛选<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">全部</option><option value="done">完成</option><option value="pending">未完成</option><option value="praise">表扬</option><option value="improve">待改进</option>
          </select></label>
          <label>排序<select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            <option value="student_no">学号</option><option value="name">姓名</option><option value="status">完成情况</option>
          </select></label>
        </div>
        <div className="student-task-table">
          <div className="student-task-head">
            <b>学号</b><b>姓名</b>
            <button type="button" className="column-select-all" title="一键切换本列全选/取消" onClick={() => toggleColumnAll("is_done")}>完成</button>
            <button type="button" className="column-select-all" title="一键切换本列全选/取消" onClick={() => toggleColumnAll("praise")}>表扬</button>
            <button type="button" className="column-select-all" title="一键切换本列全选/取消" onClick={() => toggleColumnAll("needs_improvement")}>待改进</button>
            <b>备注</b><b>操作</b>
          </div>
          {studentRows.map((row) => (
            <div className={`student-task-row ${row.praise ? "is-praise" : row.needs_improvement ? "needs-improvement" : row.is_done ? "is-done" : ""}`} key={row.student.id}>
              <span>{row.student.student_no}</span>
              <b>{row.student.name}</b>
              <input type="checkbox" checked={row.is_done} onChange={(event) => saveStatus(row.student, { is_done: event.target.checked })} />
              <input type="checkbox" checked={row.praise} onChange={(event) => saveStatus(row.student, { praise: event.target.checked })} />
              <input type="checkbox" checked={row.needs_improvement} onChange={(event) => saveStatus(row.student, { needs_improvement: event.target.checked })} />
              <input value={row.note} onChange={(event) => saveStatus(row.student, { note: event.target.value })} placeholder="可记录订正、默写错误等" />
              <button type="button" className="subtle-button" onClick={() => clearStatus(row.student)}>清除</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>{isRecitation ? "近期背默统计" : "近期作业统计"}</h2>
            <span>每列为已保存项目，点击姓名查看详情</span>
          </div>
        </div>
        <div className="recent-status-grid" style={{ "--task-count": Math.max(1, tasks.length) }}>
          <div className="recent-status-head"><b>姓名</b>{tasks.map((task) => <b key={task.id}>{task.assign_date}<br />{task.title}</b>)}</div>
          {students.map((student) => (
            <div className="recent-status-row" key={student.id}>
              <button type="button" onClick={() => setStudentDetail(student)}>{student.student_no}. {student.name}</button>
              {tasks.map((task) => {
                const status = statusFor(task, student);
                const label = status?.praise ? "表扬" : status?.needs_improvement ? "待改进" : status?.is_done ? "完成" : "";
                const cls = status?.praise ? "is-praise" : status?.needs_improvement ? "needs-improvement" : status?.is_done ? "is-done" : "";
                return <span className={cls} key={task.id}>{label}</span>;
              })}
            </div>
          ))}
        </div>
      </section>

      {editingTask && (
        <div className="modal-backdrop work-area-backdrop">
          <form className="cell-editor" onSubmit={saveEditedTask}>
            <div className="panel-title"><h2>修改{isRecitation ? "背默" : "作业"}</h2><button type="button" onClick={() => setEditingTask(null)}>关闭</button></div>
            <label>{isRecitation ? "篇目" : "作业名称"}<input value={editingTask.title} onChange={(event) => setEditingTask({ ...editingTask, title: event.target.value })} autoFocus /></label>
            <label>时间段<DateRangeField start={editingTask.assign_date} end={editingTask.due_date} onChange={({ start, end }) => setEditingTask({ ...editingTask, assign_date: start, due_date: end })} /></label>
            <label>类型<select value={editingTask.homework_type || editingTask.recitation_type || "日常作业"} onChange={(event) => setEditingTask(isRecitation ? { ...editingTask, recitation_type: event.target.value } : { ...editingTask, homework_type: event.target.value })}>
              {isRecitation ? <><option>背诵</option><option>默写</option><option>背默</option></> : <><option>日常作业</option><option>周期作业</option></>}
            </select></label>
            <label>备注<input value={editingTask.note || ""} onChange={(event) => setEditingTask({ ...editingTask, note: event.target.value })} /></label>
            <div className="modal-actions"><button type="button" className="danger-button" onClick={removeEditedTask}>删除</button><button type="submit"><Save size={16} />保存修改</button></div>
          </form>
        </div>
      )}

      {studentDetail && (
        <div className="modal-backdrop work-area-backdrop">
          <section className="detail-modal task-student-detail">
            <div className="panel-title"><h2>{studentDetail.name}</h2><button type="button" onClick={() => setStudentDetail(null)}>关闭</button></div>
            {tasks.map((task) => {
              const status = statusFor(task, studentDetail);
              return (
                <article key={task.id}>
                  <h2>{task.assign_date} {weekdayLabel(task.assign_date)}</h2>
                  <h3>{task.title}</h3>
                  <p>{status?.praise ? "表扬" : status?.needs_improvement ? "待改进" : status?.is_done ? "完成" : "未完成"}{status?.note ? `；${status.note}` : ""}</p>
                </article>
              );
            })}
          </section>
        </div>
      )}
    </section>
  );
}

function categorizeLeaderRole(role) {
  if (role.includes("课代表")) return "小课代表";
  if (role.includes("组长")) return "小组长";
  return "班级委员";
}

const LEADER_FILTER_OPTIONS = ["全部", "仅显示班级委员", "仅显示小课代表", "仅显示小组长"];

function StudentsPage({ data, updateStudentRemark, updateStudentRoles }) {
  const [keyword, setKeyword] = useState("");
  const [leaderFilter, setLeaderFilter] = useState("全部");
  const classes = Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean))).sort();
  const [selectedClass, setSelectedClass] = useState(classes.includes(data.scheduleMeta.className) ? data.scheduleMeta.className : classes[0] || "预备5班");
  const classStudents = data.students.filter((student) => student.class_name === selectedClass);
  const [selectedId, setSelectedId] = useState(classStudents[0]?.id || null);
  const resumeForStudent = (student) => (data.studentResumes || []).find((file) => file.original_name?.includes(student.name));

  useEffect(() => {
    if (!classStudents.some((student) => student.id === selectedId)) {
      setSelectedId(classStudents[0]?.id || null);
    }
  }, [selectedClass, data.students.length]);

  const filtered = classStudents.filter((student) => {
    const haystack = [
      student.student_no,
      student.name,
      student.roles,
      student.guardian,
      student.guardian_phone,
      student.father_phone,
      student.mother_phone,
      student.student_remark,
    ].join(" ");
    return haystack.includes(keyword.trim());
  });
  const selected = classStudents.find((student) => student.id === selectedId) || filtered[0] || classStudents[0];
  const selectedResume = selected ? resumeForStudent(selected) : null;
  const girls = classStudents.filter((student) => student.gender === "女").length;
  const boys = classStudents.filter((student) => student.gender === "男").length;
  const leaderMap = classStudents.reduce((map, student) => {
    const roles = String(student.roles || "")
      .split(/[、,，;；/\s]+/)
      .map((role) => role.trim())
      .filter((role) => role && !["无", "未标注", "暂无"].includes(role));
    roles.forEach((role) => {
      const current = map.get(role) || [];
      current.push({ name: student.name, gender: student.gender });
      map.set(role, current);
    });
    return map;
  }, new Map());
  const leaderEntries = Array.from(leaderMap.entries()).filter(([role]) => {
    if (leaderFilter === "全部") return true;
    const category = categorizeLeaderRole(role);
    if (leaderFilter === "仅显示班级委员") return category === "班级委员";
    if (leaderFilter === "仅显示小课代表") return category === "小课代表";
    if (leaderFilter === "仅显示小组长") return category === "小组长";
    return true;
  });

  async function printRoster() {
    await appApi.printStudentRosterPdf({ className: selectedClass });
  }

  return (
    <section className="students-page">
      <div className="metric-row students-metric-row">
        <article className="metric-card">
          <Users size={22} />
          <span>班级人数</span>
          <strong>{classStudents.length}</strong>
          <small>{selectedClass}</small>
        </article>
        <article className="metric-card">
          <GraduationCap size={22} />
          <span>女生 / 男生</span>
          <strong>{girls}/{boys}</strong>
          <small>按名单性别字段统计</small>
        </article>
        <article className="metric-card leader-card">
          <div className="leader-card-head">
            <UserCheck size={22} />
            <span>班干部</span>
            <select className="leader-filter-select" value={leaderFilter} onChange={(event) => setLeaderFilter(event.target.value)} onClick={(event) => event.stopPropagation()}>
              {LEADER_FILTER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>
          <div className="leader-grid">
            {leaderEntries.length ? leaderEntries.map(([role, students]) => (
              <p className="leader-role-row" key={role}>
                <span className="leader-role-name">{role}：</span>
                {students.map((student, index) => (
                  <span key={`${student.name}-${index}`} className={`roster-name-tag ${student.gender === "女" ? "girl" : "boy"}`}>{student.name}</span>
                ))}
              </p>
            )) : <p className="leader-role-row"><span className="leader-role-name">暂未标注</span></p>}
          </div>
        </article>
      </div>

      <section className="panel roster-panel">
        <div className="panel-title">
          <div>
            <h2>学生花名册</h2>
            <span>备注只放过敏信息；可直接点击修改，没有过敏就留空；班干部一栏双击可编辑</span>
          </div>
          <div className="roster-actions">
            <select className="class-switcher" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              {classes.map((className) => <option key={className}>{className}</option>)}
            </select>
            <input className="search-input" placeholder="搜索姓名、学号、班干部、联系方式、备注" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <button type="button" className="small-primary-button" onClick={printRoster}><FileText size={15} />导出A4名单</button>
          </div>
        </div>
        <div className="roster-layout">
          <div className="roster-table">
            <div className="roster-head">学号</div>
            <div className="roster-head">姓名</div>
            <div className="roster-head">班干部</div>
            <div className="roster-head">联系方式</div>
            <div className="roster-head">备注</div>
            {filtered.map((student) => (
              <React.Fragment key={student.id}>
                <button className="roster-cell" type="button" onClick={() => setSelectedId(student.id)}>{student.student_no}</button>
                <button className="roster-cell strong-cell" type="button" onClick={() => setSelectedId(student.id)}>
                  <span className={`roster-name-tag ${student.gender === "女" ? "girl" : "boy"}`}>{student.name}</span>
                </button>
                <RosterRolesCell student={student} setSelectedId={setSelectedId} updateStudentRoles={updateStudentRoles} />
                <button className="roster-cell" type="button" onClick={() => setSelectedId(student.id)}>{student.guardian_phone || student.phone || student.father_phone || student.mother_phone || "未填写"}</button>
                <RosterRemarkCell student={student} setSelectedId={setSelectedId} updateStudentRemark={updateStudentRemark} />
              </React.Fragment>
            ))}
          </div>

          {selected && (
            <aside className="student-detail">
              <div className="student-detail-heading">
                <div className="avatar-mark">{selected.name?.slice(-2)}</div>
                <h3>{selected.name}</h3>
              </div>
              <p>{selected.class_name} · 学号 {selected.student_no || "-"}</p>
              <div className="detail-grid">
                <span>性别</span><b>{selected.gender || "-"}</b>
                <span>出生日期</span><b>{selected.birth_date || "-"}</b>
                <span>民族</span><b>{selected.ethnicity || "-"}</b>
                <span>身高体重</span><b>{selected.height_cm || "-"} cm / {selected.weight_kg || "-"} kg</b>
                <span>监护人</span><b>{selected.guardian || "-"} {selected.guardian_relation ? `(${selected.guardian_relation})` : ""}</b>
                <span>联系电话</span><b>{selected.guardian_phone || selected.phone || "-"}</b>
                <span>父亲</span><b>{selected.father_name || "-"} {selected.father_phone || ""}</b>
                <span>母亲</span><b>{selected.mother_name || "-"} {selected.mother_phone || ""}</b>
                <span>视力</span><b>{selected.eyesight || "-"}</b>
                <span>特殊体质</span><b>{selected.health_note || "-"}</b>
                <span>备注</span><b>{selected.student_remark || "-"}</b>
              </div>
              <div className="detail-block">
                <b>班务职务 / 课代表</b>
                <span>{selected.roles || "暂无记录"}</span>
              </div>
              <div className="detail-block">
                <b>综合荣誉</b>
                <span>{selected.honors || "暂无记录"}</span>
              </div>
              <div className="detail-block">
                <b>学生简历</b>
                <StudentResumePreview resume={selectedResume} />
              </div>
              <div className="detail-block">
                <b>学科详情</b>
                <span>{selected.subject_profile || "待后续从成绩、作业、谈话记录中自动汇总。"}</span>
              </div>
            </aside>
          )}
        </div>
      </section>
    </section>
  );
}

function SeatingPage({ data, assignSeat, updateStudentProfile, randomizeSeating, rotateSeatingColumns, saveSeatingSnapshot, applySeatingSnapshot, resetSeating }) {
  const classes = Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean))).sort();
  const [selectedClass, setSelectedClass] = useState(classes.includes(data.scheduleMeta.className) ? data.scheduleMeta.className : classes[0] || "预备5班");
  const [editingStudent, setEditingStudent] = useState(null);
  const [showHeight, setShowHeight] = useState(false);
  const [showRemark, setShowRemark] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRandomRules, setShowRandomRules] = useState(false);
  const [randomRules, setRandomRules] = useState({ cols: 7, rows: 7, gender_mode: "mixed", order_mode: "random" });
  const [busyAction, setBusyAction] = useState("");
  const classStudents = data.students.filter((student) => student.class_name === selectedClass);
  const assignments = (data.seating || []).filter((item) => item.class_name === selectedClass);
  const assignmentBySeat = new Map(assignments.map((item) => [item.seat_key, item]));
  const assignedIds = new Set(assignments.map((item) => String(item.student_id)));
  const waitingStudents = classStudents.filter((student) => !assignedIds.has(String(student.id)));
  const classSnapshots = (data.seatingSnapshots || []).filter((item) => item.class_name === selectedClass);

  async function handleRandomize() {
    setBusyAction("random");
    try {
      await randomizeSeating({ class_name: selectedClass, ...randomRules });
      setShowRandomRules(false);
    } catch {
      // 错误提示已在 randomizeSeating 中弹出
    } finally {
      setBusyAction("");
    }
  }

  async function handleRotate() {
    if (!window.confirm(`每周换座位：主座位区每一列（学生面向讲台视角）整体向右移动一列，第7列会绕回第1列。确定要执行吗？`)) return;
    setBusyAction("rotate");
    try {
      await rotateSeatingColumns({ class_name: selectedClass });
    } catch {
      // 错误提示已在 rotateSeatingColumns 中弹出
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveSnapshot() {
    setBusyAction("save");
    try {
      await saveSeatingSnapshot({ class_name: selectedClass, label: snapshotLabel });
      setSnapshotLabel("");
    } catch {
      // 错误提示已在 saveSeatingSnapshot 中弹出
    } finally {
      setBusyAction("");
    }
  }

  async function handleApplySnapshot(id) {
    if (!window.confirm("应用这个历史版本会覆盖当前座位表，确定吗？")) return;
    try {
      await applySeatingSnapshot({ id });
      setShowHistory(false);
    } catch {
      // 错误提示已在 applySeatingSnapshot 中弹出
    }
  }

  async function handleReset() {
    if (!window.confirm(`一键重置：${selectedClass}全部座位安排都会清空，所有学生回到下方"待选"名单，确定吗？`)) return;
    setBusyAction("reset");
    try {
      await resetSeating({ class_name: selectedClass });
    } catch {
      // 错误提示已在 resetSeating 中弹出
    } finally {
      setBusyAction("");
    }
  }

  function dragStudent(event, studentId) {
    event.dataTransfer.setData("text/plain", String(studentId));
    event.dataTransfer.effectAllowed = "move";
  }

  async function dropStudent(event, seatKey) {
    event.preventDefault();
    const studentId = event.dataTransfer.getData("text/plain");
    if (!studentId) return;
    await assignSeat({ class_name: selectedClass, seat_key: seatKey, student_id: studentId });
  }

  async function dropWaiting(event) {
    event.preventDefault();
    const studentId = event.dataTransfer.getData("text/plain");
    if (!studentId) return;
    await assignSeat({ class_name: selectedClass, seat_key: "", student_id: studentId });
  }

  function studentFromAssignment(assignment) {
    return classStudents.find((student) => String(student.id) === String(assignment?.student_id));
  }

  function StudentTag({ student, compact = false }) {
    if (!student) return null;
    const detailItems = [];
    if (showHeight && student.height_cm) detailItems.push(`${student.height_cm}cm`);
    const isObserved = Number(student.is_observed || 0) === 1;
    if ((showRemark || isObserved) && student.seating_remark) detailItems.push(student.seating_remark);
    const label = `${student.student_no || ""} ${student.name}`.trim();
    const compactFontSize = detailItems.length ? 13 : label.length <= 5 ? 18 : label.length <= 7 ? 16 : 14;
    return (
      <button
        type="button"
        draggable
        className={`seat-student-tag ${student.gender === "女" ? "girl" : "boy"} ${isObserved ? "is-observed" : ""} ${compact ? "compact" : ""}`}
        style={compact ? { "--seat-name-size": `${compactFontSize}px` } : undefined}
        onDragStart={(event) => dragStudent(event, student.id)}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          setEditingStudent({ ...student });
        }}
      >
        <strong>{label}</strong>
        {detailItems.length > 0 && <small>{detailItems.join(" · ")}</small>}
      </button>
    );
  }

  return (
    <section className="seating-page">
      <section className="panel seating-panel">
        <div className="panel-title">
          <div>
            <h2>班级座位表</h2>
            <span>7列×7行，左侧单列，讲台在最下面；学生标签可拖拽安排，双击可编辑</span>
          </div>
          <div className="seating-actions">
            <label className={showHeight ? "is-active" : ""}><input type="checkbox" checked={showHeight} onChange={(event) => setShowHeight(event.target.checked)} />显示身高</label>
            <label className={showRemark ? "is-active" : ""}><input type="checkbox" checked={showRemark} onChange={(event) => setShowRemark(event.target.checked)} />显示备注</label>
            <select className="class-switcher" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              {classes.map((className) => <option key={className}>{className}</option>)}
            </select>
            <button type="button" className="small-primary-button" disabled={Boolean(busyAction)} onClick={() => setShowRandomRules(true)}><Shuffle size={15} />随机安排</button>
            <button type="button" className="small-primary-button" disabled={Boolean(busyAction)} onClick={handleRotate}><RefreshCcw size={15} />{busyAction === "rotate" ? "轮换中…" : "每周换座位"}</button>
            <button type="button" className="small-primary-button subtle-button" disabled={Boolean(busyAction)} onClick={handleReset}><RotateCcw size={15} />{busyAction === "reset" ? "重置中…" : "一键重置"}</button>
            <button type="button" onClick={() => setShowHistory(true)}><History size={15} />历史座位表{classSnapshots.length ? `（${classSnapshots.length}）` : ""}</button>
          </div>
        </div>
        <div className="seating-version-bar">
          <input
            value={snapshotLabel}
            onChange={(event) => setSnapshotLabel(event.target.value)}
            placeholder="版本备注（可选，如：期中考试后调整）"
          />
          <button type="button" className="small-primary-button" disabled={busyAction === "save"} onClick={handleSaveSnapshot}><Save size={15} />{busyAction === "save" ? "保存中…" : "保存当前为版本"}</button>
        </div>
        <div className="seating-stage">
          <div className="single-seat-column">
            {Array.from({ length: 7 }, (_, row) => {
              const displayRow = 7 - row;
              const seatKey = `solo-${displayRow}`;
              const student = studentFromAssignment(assignmentBySeat.get(seatKey));
              return (
                <div className={`seat-cell single ${student ? "is-occupied" : ""}`} key={seatKey} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropStudent(event, seatKey)}>
                  <small>单列{displayRow}</small>
                  <StudentTag student={student} compact />
                </div>
              );
            })}
          </div>
          <div className="seat-grid">
            {Array.from({ length: 7 }, (_, row) => (
              Array.from({ length: 7 }, (_, col) => {
                const displayRow = 7 - row;
                const seatKey = `r${displayRow}c${col + 1}`;
                const student = studentFromAssignment(assignmentBySeat.get(seatKey));
                return (
                  <div className={`seat-cell ${student ? "is-occupied" : ""}`} key={seatKey} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropStudent(event, seatKey)}>
                    <small>{displayRow}-{col + 1}</small>
                    <StudentTag student={student} compact />
                  </div>
                );
              })
            ))}
          </div>
        </div>
        <div className="podium">讲台</div>
      </section>

      <section className="panel waiting-students-panel" onDragOver={(event) => event.preventDefault()} onDrop={dropWaiting}>
        <div className="panel-title">
          <div>
            <h2>待安排学生</h2>
            <span>拖回这里可取消座位；点击标签可标注身高和备注</span>
          </div>
          <small>{waitingStudents.length} 人待安排</small>
        </div>
        <div className="waiting-student-tags">
          {waitingStudents.map((student) => <StudentTag student={student} key={student.id} />)}
          {!waitingStudents.length && <span>所有学生已安排座位。</span>}
        </div>
      </section>

      {editingStudent && (
        <div className="modal-backdrop work-area-backdrop">
          <form className="cell-editor student-seat-editor" onSubmit={async (event) => {
            event.preventDefault();
            await updateStudentProfile({
              id: editingStudent.id,
              height_cm: editingStudent.height_cm,
              seating_remark: editingStudent.seating_remark,
              is_observed: editingStudent.is_observed ? 1 : 0
            });
            setEditingStudent(null);
          }}>
            <div className="panel-title">
              <div>
                <h2>{editingStudent.name}</h2>
                <span>{editingStudent.class_name} · 学号 {editingStudent.student_no || "-"}</span>
              </div>
              <button type="button" onClick={() => setEditingStudent(null)}>关闭</button>
            </div>
            <label>身高<input value={editingStudent.height_cm || ""} onChange={(event) => setEditingStudent({ ...editingStudent, height_cm: event.target.value })} placeholder="如 158" /></label>
            <label className="checkbox-line"><input type="checkbox" checked={Boolean(editingStudent.is_observed)} onChange={(event) => setEditingStudent({ ...editingStudent, is_observed: event.target.checked ? 1 : 0 })} />待观察</label>
            <label>座位备注<textarea value={editingStudent.seating_remark || ""} onChange={(event) => setEditingStudent({ ...editingStudent, seating_remark: event.target.value })} placeholder="只用于座位表，如视线、同桌提醒、临时观察等" /></label>
            <button type="submit"><Save size={16} />保存标注</button>
          </form>
        </div>
      )}

      {showHistory && (
        <SeatingHistoryModal
          snapshots={classSnapshots}
          onClose={() => setShowHistory(false)}
          onApply={handleApplySnapshot}
        />
      )}
      {showRandomRules && (
        <div className="modal-backdrop work-area-backdrop" onClick={() => setShowRandomRules(false)}>
          <form className="cell-editor seating-random-modal" onSubmit={(event) => {
            event.preventDefault();
            handleRandomize();
          }} onClick={(event) => event.stopPropagation()}>
            <div className="panel-title">
              <div>
                <h2>随机安排规则</h2>
                <span>{selectedClass} · 会覆盖当前主座位区，建议先保存当前版本</span>
              </div>
              <button type="button" onClick={() => setShowRandomRules(false)}>关闭</button>
            </div>
            <div className="seating-random-grid">
              <label>列数<input type="number" min="1" max="7" value={randomRules.cols} onChange={(event) => setRandomRules({ ...randomRules, cols: Number(event.target.value) })} /></label>
              <label>排数<input type="number" min="1" max="7" value={randomRules.rows} onChange={(event) => setRandomRules({ ...randomRules, rows: Number(event.target.value) })} /></label>
              <label>男女规则<select value={randomRules.gender_mode} onChange={(event) => setRandomRules({ ...randomRules, gender_mode: event.target.value })}><option value="mixed">男女混排</option><option value="none">不按性别</option></select></label>
              <label>排序规则<select value={randomRules.order_mode} onChange={(event) => setRandomRules({ ...randomRules, order_mode: event.target.value })}><option value="random">随机顺序</option><option value="student_no">按学号顺序</option></select></label>
            </div>
            <button type="submit" className="small-primary-button" disabled={busyAction === "random"}><Shuffle size={15} />{busyAction === "random" ? "安排中…" : "按规则安排"}</button>
          </form>
        </div>
      )}
    </section>
  );
}

// 历史座位表：左边列出这个班保存过的版本，点一个在右边只读预览（7×7 主座位区 + 左侧单列），
// 预览数据直接来自存档时打包好的学生姓名/性别，不依赖当前花名册，所以哪怕后续学生转班也还能看
function SeatingHistoryModal({ snapshots, onClose, onApply }) {
  const [viewingId, setViewingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [loading, setLoading] = useState(false);

  async function view(id) {
    setViewingId(id);
    setViewing(null);
    setLoading(true);
    const result = await appApi.getSeatingSnapshot({ id });
    setLoading(false);
    setViewing(result?.ok ? result : null);
  }

  const seatMap = new Map((viewing?.seats || []).map((seat) => [seat.seat_key, seat]));

  return (
    <div className="modal-backdrop work-area-backdrop">
      <div className="cell-editor seating-history-modal">
        <div className="panel-title">
          <div>
            <h2>历史座位表</h2>
            <span>{snapshots.length ? `共 ${snapshots.length} 个存档版本，点左侧查看` : "还没有保存过版本"}</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="seating-history-layout">
          <div className="seating-history-list">
            {snapshots.map((snapshot) => (
              <button
                key={snapshot.id}
                type="button"
                className={`seating-history-item ${String(viewingId) === String(snapshot.id) ? "is-active" : ""}`}
                onClick={() => view(snapshot.id)}
              >
                <b>{snapshot.label || "未命名版本"}</b>
                <small>{String(snapshot.created_at || "").slice(0, 16).replace("T", " ")} · {snapshot.seat_count} 个座位</small>
              </button>
            ))}
            {!snapshots.length && <span className="empty-row">保存一次当前座位表后，会出现在这里</span>}
          </div>
          <div className="seating-history-preview">
            {loading && <span>正在读取…</span>}
            {!loading && viewingId != null && !viewing && <span>这个版本读取失败或已损坏</span>}
            {!loading && viewing && (
              <>
                <div className="seating-history-stage">
                  <div className="seating-history-solo">
                    {Array.from({ length: 7 }, (_, row) => {
                      const displayRow = 7 - row;
                      const seat = seatMap.get(`solo-${displayRow}`);
                      return (
                        <div className={`seating-history-cell ${seat ? (seat.gender === "女" ? "girl" : "boy") : ""}`} key={`solo-${displayRow}`}>
                          {seat?.student_name || ""}
                        </div>
                      );
                    })}
                  </div>
                  <div className="seating-history-grid">
                    {Array.from({ length: 7 }, (_, row) => (
                      Array.from({ length: 7 }, (_, col) => {
                        const displayRow = 7 - row;
                        const seat = seatMap.get(`r${displayRow}c${col + 1}`);
                        return (
                          <div className={`seating-history-cell ${seat ? (seat.gender === "女" ? "girl" : "boy") : ""}`} key={`r${displayRow}c${col + 1}`}>
                            {seat?.student_name || ""}
                          </div>
                        );
                      })
                    ))}
                  </div>
                </div>
                <div className="seating-history-podium">讲台</div>
                <button type="button" className="small-primary-button" onClick={() => onApply(viewing.id)}>应用此版本为当前座位表</button>
              </>
            )}
            {!loading && viewingId == null && <span>点击左侧的版本查看座位安排</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RosterRemarkCell({ student, setSelectedId, updateStudentRemark }) {
  const [remark, setRemark] = useState(student.student_remark || "");

  useEffect(() => {
    setRemark(student.student_remark || "");
  }, [student.id, student.student_remark]);

  function commit() {
    if ((student.student_remark || "") === remark) return;
    updateStudentRemark(student, remark);
  }

  return (
    <div className="roster-cell note-cell editable-note-cell" onClick={() => setSelectedId(student.id)}>
      <input
        value={remark}
        placeholder=""
        onClick={(event) => event.stopPropagation()}
        onFocus={() => setSelectedId(student.id)}
        onChange={(event) => setRemark(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

// 班干部一栏默认只显示文字，双击后才切换成输入框；失焦/回车提交，Esc 放弃修改。
// 保存后 student.roles 会随 data 一起刷新，页面顶部“班干部”汇总卡片会自动重新按角色分组，不用额外同步。
function RosterRolesCell({ student, setSelectedId, updateStudentRoles }) {
  const [editing, setEditing] = useState(false);
  const [roles, setRoles] = useState(student.roles || "");

  useEffect(() => {
    setRoles(student.roles || "");
    setEditing(false);
  }, [student.id, student.roles]);

  function commit() {
    setEditing(false);
    if ((student.roles || "") === roles) return;
    updateStudentRoles(student, roles).catch(() => {
      // 错误提示已在 updateStudentRoles 中弹出
    });
  }

  if (editing) {
    return (
      <div className="roster-cell note-cell editable-note-cell">
        <input
          autoFocus
          value={roles}
          placeholder="如：语文课代表、劳动委员"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setRoles(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setRoles(student.roles || "");
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <button
      className="roster-cell"
      type="button"
      title="双击编辑班干部 / 职务"
      onClick={() => setSelectedId(student.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setSelectedId(student.id);
        setEditing(true);
      }}
    >
      {student.roles || "未标注"}
    </button>
  );
}

// 点击学生后按需读取简历文件（主进程转成 data URL 返回），图片直接显示，PDF 等非图片文件给一个“用系统程序打开”按钮
// 友好化一下 Electron IPC 报错的原始文案（比如 handler 没注册），提示用户大概率是应用没完全重启
function friendlyFileError(reason) {
  const text = String(reason || "");
  if (text.includes("No handler registered") || text.includes("invoking remote method")) {
    return "读取失败：应用可能还没完全重启（改动只在重新打开桌面应用后才生效），请完全退出后重新打开一次再试。";
  }
  return text || "简历文件暂时无法读取";
}

const RESUME_ZOOM_MIN = 0.5;
const RESUME_ZOOM_MAX = 4;
const RESUME_ZOOM_STEP = 0.25;

function StudentResumePreview({ resume }) {
  const [state, setState] = useState({ status: "empty" });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setLightboxOpen(false);
    setZoom(1);
    if (!resume) {
      setState({ status: "empty" });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading" });
    appApi.readFilePreview({ id: resume.id }).then((result) => {
      if (cancelled) return;
      if (result?.ok) setState({ status: "ready", ...result });
      else setState({ status: "error", reason: friendlyFileError(result?.reason) });
    }).catch((error) => {
      if (!cancelled) setState({ status: "error", reason: friendlyFileError(error?.message) });
    });
    return () => {
      cancelled = true;
    };
  }, [resume?.id]);

  if (state.status === "empty") return <span>未匹配到简历文件</span>;
  if (state.status === "loading") return <span>正在读取简历…</span>;
  if (state.status === "error") return <span>{state.reason}</span>;
  if (state.status === "ready" && state.isImage) {
    return (
      <>
        <button type="button" className="resume-thumb-button" onClick={() => setLightboxOpen(true)} title="点击放大查看">
          <img className="resume-preview-thumb" src={state.dataUrl} alt={resume.original_name || "学生简历"} />
        </button>
        {lightboxOpen && createPortal(
          <div className="modal-backdrop resume-lightbox-backdrop" onClick={() => setLightboxOpen(false)}>
            <img
              className="resume-lightbox-image"
              src={state.dataUrl}
              alt={resume.original_name || "学生简历"}
              style={{ transform: `scale(${zoom})` }}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => {
                event.stopPropagation();
                event.preventDefault();
                setZoom((value) => clamp(Number((value + (event.deltaY < 0 ? RESUME_ZOOM_STEP : -RESUME_ZOOM_STEP)).toFixed(2)), RESUME_ZOOM_MIN, RESUME_ZOOM_MAX));
              }}
            />
            <div className="resume-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => setZoom((value) => clamp(Number((value - RESUME_ZOOM_STEP).toFixed(2)), RESUME_ZOOM_MIN, RESUME_ZOOM_MAX))} title="缩小">－</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((value) => clamp(Number((value + RESUME_ZOOM_STEP).toFixed(2)), RESUME_ZOOM_MIN, RESUME_ZOOM_MAX))} title="放大">＋</button>
              <button type="button" onClick={() => setZoom(1)} title="恢复原始比例">复位</button>
            </div>
            <button type="button" className="resume-lightbox-close" onClick={() => setLightboxOpen(false)}>关闭</button>
          </div>,
          document.body
        )}
      </>
    );
  }
  return (
    <div className="resume-preview-file">
      <span>{resume.original_name || "简历文件"}（{state.mime === "application/pdf" ? "PDF" : "非图片格式"}，暂不支持内嵌预览）</span>
      <button type="button" className="small-primary-button" onClick={() => appApi.openFileExternal({ id: resume.id })}>用系统程序打开</button>
    </div>
  );
}

function CooperationPage({ data, selectedClass, setSelectedClass, draft, setDraft, addRecord, addGroup, updateGroup, setMembers, addProject, updateProject, deleteProject }) {
  const classes = data.appConfig.teachingClasses || ["预备5班", "预备6班"];
  const groups = (data.cooperation?.groups || []).filter((group) => group.class_name === selectedClass);
  const members = (data.cooperation?.members || []).filter((member) => member.class_name === selectedClass);
  const records = (data.cooperation?.records || []).filter((record) => record.class_name === selectedClass);
  const projects = (data.cooperation?.projects || []).filter((project) => project.class_name === selectedClass);
  const classStudents = data.students.filter((student) => student.class_name === selectedClass);
  const selectedGroup = groups.find((group) => String(group.id) === String(draft.group_id)) || groups[0];
  const groupMembers = members.filter((member) => String(member.group_id) === String(selectedGroup?.id || ""));
  const totalPoints = groups.reduce((sum, group) => sum + Number(group.points || 0), 0);
  const topGroup = [...groups].sort((a, b) => Number(b.points || 0) - Number(a.points || 0))[0];
  const [selectedBuildGroupId, setSelectedBuildGroupId] = useState(groups[0]?.id || "");
  // 一个班可能先后建过好几批分组（常用分组 + 多个临时划分），但同一时刻真正在用的只有一批（最多6个小组）；
  // activeGoal 记录当前正在编辑/使用的是哪一批（按 goal 区分），新建分组时自动切到新的一批。
  const [activeGoal, setActiveGoal] = useState(groups[0]?.goal || "");
  const [groupEdit, setGroupEdit] = useState({ name: "", goal: "", color: "#1f67b1", group_kind: "常用", photo_path: "" });
  const [groupDrafts, setGroupDrafts] = useState({});
  const [assignments, setAssignments] = useState({});
  const [memberMessage, setMemberMessage] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(classStudents[0]?.id || "");
  const [toolMode, setToolMode] = useState("");
  const [groupBuildEditing, setGroupBuildEditing] = useState(false);
  const [groupDivisionName, setGroupDivisionName] = useState("");
  const [projectFilters, setProjectFilters] = useState({ type: "全部", progress: "全部", sort: "周期近到远" });
  const [battleView, setBattleView] = useState("group");
  const [battleFilters, setBattleFilters] = useState({ startDate: "", endDate: "", projectType: "全部", projectKey: "全部" });
  const [editingProject, setEditingProject] = useState(null);
  const [scoreEntry, setScoreEntry] = useState(null);
  const [projectDraft, setProjectDraft] = useState({
    project_date: todayIso(),
    end_date: todayIso(),
    period_label: `${todayIso()} 至 ${todayIso()}`,
    class_name: selectedClass,
    project_name: "",
    project_type: "日常行规",
    progress: "进行中",
    division: "",
    activity_detail: "",
    evaluation_note: "",
    group_scores: {},
    personal_scores: {},
    evaluation_file_path: ""
  });
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const recordTypes = [
    { key: "achievement", label: "成就加分" },
    { key: "reminder", label: "提醒扣分" }
  ];
  const achievementCategories = ["课堂合作", "作业表现", "朗读表达", "卫生值日", "活动贡献", "进步表扬"];
  const reminderCategories = ["课堂纪律", "作业拖欠", "行为提醒", "值日问题", "活动冲突", "其他"];
  const categories = draft.type === "achievement" ? achievementCategories : reminderCategories;

  useEffect(() => {
    const firstGroup = groups[0];
    const firstMember = firstGroup ? members.find((member) => member.group_id === firstGroup.id) : null;
    setDraft((current) => ({
      ...current,
      class_name: selectedClass,
      group_id: current.group_id && groups.some((group) => String(group.id) === String(current.group_id)) ? current.group_id : firstGroup?.id || "",
      student_id: current.student_id && members.some((member) => String(member.student_id) === String(current.student_id)) ? current.student_id : firstMember?.student_id || "",
      category: categories.includes(current.category) ? current.category : categories[0]
    }));
  }, [selectedClass, data.cooperation?.groups?.length, data.cooperation?.members?.length, draft.type]);

  useEffect(() => {
    // 换班级时，重新定位到该班第一批分组（按 goal 归类），避免沿用上一个班级的 activeGoal
    setActiveGoal(groups[0]?.goal || "");
  }, [selectedClass]);

  useEffect(() => {
    const firstGroup = groups[0];
    const activeGroup = groups.find((group) => String(group.id) === String(selectedBuildGroupId)) || firstGroup;
    setSelectedBuildGroupId(activeGroup?.id || "");
    setGroupEdit({
      name: activeGroup?.name || "",
      goal: activeGroup?.goal || "",
      color: activeGroup?.color || "#1f67b1",
      group_kind: activeGroup?.group_kind || "常用",
      photo_path: ""
    });
    const nextAssignments = {};
    for (const group of groups) {
      // 只回填"当前正在使用的这一批分组"（activeGoal）的真实名单；其它批次的小组先按空白处理，
      // 这样新建/切换到一批分组时，待选名单会显示全班学生，等待重新拖动分配。
      const isActiveDivision = !activeGoal || (group.goal || "") === activeGoal;
      nextAssignments[group.id] = isActiveDivision
        ? members.filter((member) => member.group_id === group.id).map((member) => String(member.student_id))
        : [];
    }
    setAssignments(nextAssignments);
    setGroupDrafts(Object.fromEntries(groups.map((group) => [group.id, {
      name: group.name || "",
      goal: group.goal || "",
      color: group.color || "#1f67b1",
      group_kind: group.group_kind || "常用",
      photo_path: ""
    }])));
    setProjectDraft((current) => ({ ...current, class_name: selectedClass }));
    setSelectedStudentId((current) => classStudents.some((student) => String(student.id) === String(current)) ? current : classStudents[0]?.id || "");
  }, [selectedClass, groups.length, members.length, classStudents.length, activeGoal]);

  const assignedFlat = Object.values(assignments).flat().map(String);
  const duplicatedIds = assignedFlat.filter((id, index) => assignedFlat.indexOf(id) !== index);
  const missingStudents = classStudents.filter((student) => !assignedFlat.includes(String(student.id)));
  const selectedBuildGroup = groups.find((group) => String(group.id) === String(selectedBuildGroupId)) || groups[0];
  const selectedStudent = classStudents.find((student) => String(student.id) === String(selectedStudentId));
  const groupedProjects = Object.values(projects.reduce((acc, project) => {
    const key = `${project.project_date}|${project.project_name}|${project.project_type}`;
    acc[key] = acc[key] || { key, ...project, rows: [] };
    acc[key].rows.push(project);
    return acc;
  }, {}));
  const filteredProjects = groupedProjects
    .filter((project) => projectFilters.type === "全部" || project.project_type === projectFilters.type)
    .filter((project) => projectFilters.progress === "全部" || (project.progress || "进行中") === projectFilters.progress)
    .sort((a, b) => {
      if (projectFilters.sort === "名称") return (a.project_name || "").localeCompare(b.project_name || "", "zh-Hans-CN");
      if (projectFilters.sort === "类型") return (a.project_type || "").localeCompare(b.project_type || "", "zh-Hans-CN");
      if (projectFilters.sort === "进度") return (a.progress || "").localeCompare(b.progress || "", "zh-Hans-CN");
      return (b.project_date || "").localeCompare(a.project_date || "");
    });
  const selectedProject = groupedProjects.find((project) => project.key === selectedProjectKey);
  const projectScoreColumns = [...groupedProjects].sort((a, b) => (a.project_date || "").localeCompare(b.project_date || ""));
  const battleProjects = projectScoreColumns.filter((project) => {
    const [start = project.project_date, end = project.project_date] = String(project.period_label || "").split(/\s*至\s*/);
    const projectStart = start || project.project_date || "";
    const projectEnd = end || project.project_date || projectStart;
    const matchesStart = !battleFilters.startDate || projectEnd >= battleFilters.startDate;
    const matchesEnd = !battleFilters.endDate || projectStart <= battleFilters.endDate;
    const matchesType = battleFilters.projectType === "全部" || project.project_type === battleFilters.projectType;
    const matchesProject = battleFilters.projectKey === "全部" || project.key === battleFilters.projectKey;
    return matchesStart && matchesEnd && matchesType && matchesProject;
  });
  const groupingOptions = Array.from(new Set([
    "常用小组划分",
    ...groups.map((group) => group.goal).filter(Boolean),
    ...groups.filter((group) => group.group_kind === "临时").map((group) => group.name.replace(/\d+组$/, ""))
  ]));

  function parseJson(value, fallback = {}) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }
  const buildGroups = (activeGoal ? groups.filter((group) => (group.goal || "") === activeGoal) : groups).slice(0, 6);
  const divisionGoals = Array.from(new Set(groups.map((group) => group.goal || "默认分组")));
  const studentById = new Map(classStudents.map((student) => [String(student.id), student]));
  const groupBattleStats = buildGroups.map((group) => {
    const memberIds = members.filter((member) => String(member.group_id) === String(group.id)).map((member) => String(member.student_id));
    const groupScore = battleProjects.reduce((sum, project) => {
      const row = project.rows.find((item) => String(item.group_id) === String(group.id));
      return sum + Number(row?.points || 0);
    }, 0);
    const personalScore = battleProjects.reduce((sum, project) => {
      const scores = parseJson(project.personal_scores_json);
      return sum + memberIds.reduce((memberSum, studentId) => memberSum + Number(scores?.[studentId] || 0), 0);
    }, 0);
    return { group, memberIds, groupScore, personalScore, total: groupScore + personalScore };
  }).sort((a, b) => b.total - a.total);
  const groupRankById = new Map(groupBattleStats.map((item, index) => [String(item.group.id), index + 1]));
  const personalBattleRows = classStudents.map((student) => {
    const scoresByProject = Object.fromEntries(battleProjects.map((project) => {
      const scores = parseJson(project.personal_scores_json);
      return [project.key, Number(scores?.[student.id] ?? scores?.[String(student.id)] ?? 0)];
    }));
    const total = Object.values(scoresByProject).reduce((sum, value) => sum + Number(value || 0), 0);
    return { student, scoresByProject, total };
  }).sort((a, b) => b.total - a.total || String(a.student.student_no || "").localeCompare(String(b.student.student_no || ""), "zh-Hans-CN"));
  const placeholderScoreColumns = Array.from({ length: Math.max(0, 8 - battleProjects.length) }, (_, index) => `预留${index + 1}`);

  function exportBattleStats() {
    const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = battleView === "group"
      ? [["小组序号", "组名", "小组得分", "个人得分", "合计", "名次"], ...groupBattleStats.map((item, index) => [
        buildGroups.findIndex((group) => String(group.id) === String(item.group.id)) + 1,
        item.group.name,
        item.groupScore,
        item.personalScore,
        item.total,
        index + 1
      ])]
      : [["学号", "姓名", "合计", ...battleProjects.map((project) => project.project_name)], ...personalBattleRows.map((row) => [
        row.student.student_no || "",
        row.student.name,
        row.total,
        ...battleProjects.map((project) => row.scoresByProject[project.key] || 0),
      ])];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `合作战绩-${selectedClass}-${battleView === "group" ? "小组视图" : "列表视图"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function updateAssignment(groupId, studentId, checked = true) {
    const next = {};
    for (const group of groups) {
      next[group.id] = (assignments[group.id] || []).filter((id) => String(id) !== String(studentId));
    }
    if (checked) next[groupId] = [...(next[groupId] || []), String(studentId)];
    setAssignments(next);
    setMemberMessage("");
  }

  function moveStudentToUnassigned(studentId) {
    const next = {};
    for (const group of groups) {
      next[group.id] = (assignments[group.id] || []).filter((id) => String(id) !== String(studentId));
    }
    setAssignments(next);
    setMemberMessage("");
  }

  function updateGroupDraft(groupId, changes) {
    setGroupDrafts((current) => ({
      ...current,
      [groupId]: {
        name: current[groupId]?.name || "",
        goal: current[groupId]?.goal || "",
        color: current[groupId]?.color || "#1f67b1",
        photo_path: "",
        group_kind: current[groupId]?.group_kind || "常用",
        ...changes
      }
    }));
  }

  function dragStudent(event, studentId) {
    event.dataTransfer.setData("text/plain", String(studentId));
    event.dataTransfer.effectAllowed = "move";
  }

  function dropStudent(event, groupId) {
    event.preventDefault();
    const studentId = event.dataTransfer.getData("text/plain");
    if (studentId) updateAssignment(groupId, studentId, true);
  }

  function dropToUnassigned(event) {
    event.preventDefault();
    const studentId = event.dataTransfer.getData("text/plain");
    if (studentId) moveStudentToUnassigned(studentId);
  }

  async function saveMembers() {
    const result = await setMembers({ class_name: selectedClass, assignments });
    setMemberMessage(result?.ok === false ? result.message : "小组名单已保存。");
    if (result?.ok !== false) {
      setGroupBuildEditing(false);
    }
  }

  async function createTempGroup(randomize = false) {
    const name = groupDivisionName.trim() || `临时划分${groups.filter((group) => group.group_kind === "临时").length + 1}`;
    let updated = null;
    for (let index = 1; index <= 6; index += 1) {
      updated = await addGroup({
        class_name: selectedClass,
        name: `${name}${index}组`,
        goal: name,
        color: ["#1f67b1", "#5aa37a", "#d99a1e", "#cf6f8f", "#6b7fd7", "#8a6f4d"][index - 1],
        group_kind: "临时"
      });
    }
    setGroupDivisionName("");
    setGroupBuildEditing(true);
    setActiveGoal(name);
    if (!randomize || !updated) return;
    // 随机分组：新建的这一批小组直接把全班学生随机、均匀地分进去，并立即保存（这批分组变成当前使用的分组，
    // 其它批次的小组名单不受影响，只是不再是"当前"）。
    const newGroups = (updated.cooperation?.groups || []).filter((group) =>
      group.class_name === selectedClass && group.goal === name && group.group_kind === "临时"
    );
    if (!newGroups.length) return;
    // 男女生分开洗牌后各自轮询分配到各组，保证每组男女人数尽量接近，而不是纯随机导致某组全男或全女。
    const boys = classStudents.filter((student) => student.gender === "男").sort(() => Math.random() - 0.5);
    const girls = classStudents.filter((student) => student.gender !== "男").sort(() => Math.random() - 0.5);
    const randomAssignments = {};
    newGroups.forEach((group) => { randomAssignments[group.id] = []; });
    boys.forEach((student, index) => {
      const target = newGroups[index % newGroups.length];
      randomAssignments[target.id].push(String(student.id));
    });
    girls.forEach((student, index) => {
      const target = newGroups[index % newGroups.length];
      randomAssignments[target.id].push(String(student.id));
    });
    const result = await setMembers({ class_name: selectedClass, assignments: randomAssignments });
    setMemberMessage(result?.ok === false ? result.message : "已随机分组并保存小组名单。");
    if (result?.ok !== false) {
      setGroupBuildEditing(false);
    }
  }

  async function submitProject(event) {
    const groupScores = Object.fromEntries(buildGroups.map((group) => [group.id, projectDraft.group_scores[group.id] || 0]));
    await addProject(event, {
      ...projectDraft,
      period_label: `${projectDraft.project_date} 至 ${projectDraft.end_date}`,
      group_scores: groupScores
    });
    setProjectDraft((current) => ({
      ...current,
      project_name: "",
      project_date: todayIso(),
      end_date: todayIso(),
      period_label: `${todayIso()} 至 ${todayIso()}`,
      progress: "进行中",
      division: "",
      activity_detail: "",
      evaluation_note: "",
      group_scores: {},
      personal_scores: {},
      evaluation_file_path: ""
    }));
  }

  function startEditProject(project) {
    setEditingProject(projectToEditable(project));
    setSelectedProjectKey(project.key);
  }

  function projectToEditable(project) {
    const ids = project.rows.map((row) => row.id);
    const groupScores = Object.fromEntries(project.rows.map((row) => [row.group_id, row.points || 0]));
    const personalScores = parseJson(project.personal_scores_json);
    const [start, end] = String(project.period_label || "").split(/\s*至\s*/);
    return {
      ...project,
      ids,
      project_date: start || project.project_date || todayIso(),
      end_date: end || project.project_date || todayIso(),
      group_scores: groupScores,
      personal_scores: personalScores
    };
  }

  async function saveProjectDetail(nextProject) {
    await updateProject({
      ...nextProject,
      period_label: `${nextProject.project_date} 至 ${nextProject.end_date}`
    });
    setEditingProject(null);
    setSelectedProjectKey("");
  }

  async function removeProject(project) {
    await deleteProject({ ids: project.rows.map((row) => row.id) });
    if (selectedProjectKey === project.key) setSelectedProjectKey("");
  }

  function openScoreEntry(mode, projectKey = battleFilters.projectKey) {
    const project = groupedProjects.find((item) => item.key === projectKey) || battleProjects[0] || groupedProjects[0];
    if (!project) {
      window.alert("请先新增一个合作项目，再登记分数。");
      return;
    }
    setScoreEntry({ mode, project: projectToEditable(project) });
  }

  function updateScoreEntryProject(changes) {
    setScoreEntry((current) => current ? { ...current, project: { ...current.project, ...changes } } : current);
  }

  async function saveScoreEntry(event) {
    event.preventDefault();
    if (!scoreEntry?.project) return;
    await updateProject({
      ...scoreEntry.project,
      period_label: `${scoreEntry.project.project_date} 至 ${scoreEntry.project.end_date}`
    });
    setScoreEntry(null);
  }

  return (
    <section className="cooperation-page">
      <div className="metric-row">
        <article className="metric-card">
          <Users size={22} />
          <span>小组数量</span>
          <strong>{groups.length}</strong>
          <small>{selectedClass}</small>
        </article>
        <article className="metric-card">
          <LayoutDashboard size={22} />
          <span>小组总分</span>
          <strong>{totalPoints}</strong>
          <small>成就与提醒合并统计</small>
        </article>
        <article className="metric-card">
          <CheckCircle2 size={22} />
          <span>成就记录</span>
          <strong>{records.filter((record) => record.type === "achievement").length}</strong>
          <small>课堂、作业、活动等</small>
        </article>
        <article className="metric-card">
          <Bell size={22} />
          <span>提醒记录</span>
          <strong>{records.filter((record) => record.type === "reminder").length}</strong>
          <small>行为、纪律、作业问题</small>
        </article>
      </div>

      <section className="panel group-build-panel">
        <div className="panel-title">
          <div>
            <h2>小组建设</h2>
            <span>默认显示常用小组划分；需要调整时再展开编辑</span>
          </div>
          <div className="group-build-actions">
            <input placeholder="新增划分名称" value={groupDivisionName} onChange={(event) => setGroupDivisionName(event.target.value)} />
            <button type="button" className="soft-button" onClick={() => createTempGroup(false)}><Plus size={15} />新增小组划分</button>
            <button type="button" className="soft-button" onClick={() => createTempGroup(true)}><Shuffle size={15} />随机分组</button>
            <button type="button" className="small-primary-button" onClick={() => setGroupBuildEditing((value) => !value)}>{groupBuildEditing ? "收起名单" : "编辑名单"}</button>
            {divisionGoals.length > 1 && (
              <select
                className="class-switcher"
                title="切换查看/编辑哪一批分组"
                value={activeGoal || "默认分组"}
                onChange={(event) => setActiveGoal(event.target.value === "默认分组" ? "" : event.target.value)}
              >
                {divisionGoals.map((goalLabel) => <option key={goalLabel} value={goalLabel}>{goalLabel}</option>)}
              </select>
            )}
            <select className="class-switcher" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              {classes.map((className) => <option key={className}>{className}</option>)}
            </select>
          </div>
        </div>
        {!groupBuildEditing && (
          <div className="fixed-group-view">
            {buildGroups.map((group, index) => {
              const groupMemberList = members.filter((member) => String(member.group_id) === String(group.id));
              return (
                <article className="fixed-group-card" key={group.id} style={{ "--group-color": group.color }}>
                  <div>
                    <b>{index + 1}. {group.name}</b>
                    <small>{group.group_kind || "常用"} · {groupMemberList.length} 人</small>
                  </div>
                  <p>{groupMemberList.map((member) => member.name).join("、") || "暂无成员"}</p>
                </article>
              );
            })}
          </div>
        )}
        {groupBuildEditing && <div className="compact-group-builder">
          <aside className="unassigned-panel" onDragOver={(event) => event.preventDefault()} onDrop={dropToUnassigned}>
            <b>未分组</b>
            <span>{missingStudents.length ? `${missingStudents.length} 人，可拖入小组` : "已全部分组"}</span>
            <div className="student-chip-list">
              {missingStudents.map((student) => (
                <button className="draggable-student" draggable type="button" key={student.id} onDragStart={(event) => dragStudent(event, student.id)}>
                  {student.student_no}. {student.name}
                </button>
              ))}
            </div>
          </aside>
          <div className="group-member-editor compact">
            {buildGroups.map((group, index) => {
              const draftItem = groupDrafts[group.id] || group;
              const studentIds = assignments[group.id] || [];
              return (
                <article
                  className="member-editor-group compact"
                  key={group.id}
                  style={{ "--group-color": draftItem.color || group.color }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropStudent(event, group.id)}
                >
                  <div className="compact-group-head">
                    <strong>{index + 1}</strong>
                    <input value={draftItem.name || ""} onChange={(event) => updateGroupDraft(group.id, { name: event.target.value })} placeholder="小组名称" />
                    <select value={draftItem.group_kind || "常用"} onChange={(event) => updateGroupDraft(group.id, { group_kind: event.target.value })}>
                      <option>常用</option>
                      <option>临时</option>
                    </select>
                    <input type="color" value={draftItem.color || "#1f67b1"} onChange={(event) => updateGroupDraft(group.id, { color: event.target.value })} aria-label="小组颜色" />
                  </div>
                  <input className="compact-goal-input" value={draftItem.goal || ""} onChange={(event) => updateGroupDraft(group.id, { goal: event.target.value })} placeholder="建设目标，可不填" />
                  <div className="compact-member-dropzone">
                    {studentIds.length === 0 && <span>把学生拖到这里</span>}
                    {studentIds.map((studentId) => {
                      const student = studentById.get(String(studentId));
                      if (!student) return null;
                      return (
                        <button
                          className="draggable-student in-group"
                          draggable
                          type="button"
                          key={studentId}
                          onDragStart={(event) => dragStudent(event, studentId)}
                          onDoubleClick={() => moveStudentToUnassigned(studentId)}
                          title="拖到其他小组，或双击移回未分组"
                        >
                          {student.student_no}. {student.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="compact-group-actions">
                    <label>照片<input type="file" accept="image/*" onChange={(event) => updateGroupDraft(group.id, { photo_path: event.target.files?.[0]?.path || "" })} /></label>
                    <button type="button" onClick={() => updateGroup({ id: group.id, ...draftItem })}><Save size={14} />保存</button>
                    <button type="button" onClick={() => updateGroup({ id: group.id, ...draftItem, group_kind: "常用" })}><CheckCircle2 size={14} />设为常用</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>}
        {groupBuildEditing && (
          <div className="member-audit">
            <span className={missingStudents.length ? "warn" : "ok"}>未分组：{missingStudents.length ? missingStudents.map((student) => student.name).join("、") : "无"}</span>
            <span className={duplicatedIds.length ? "warn" : "ok"}>重复分组：{duplicatedIds.length ? Array.from(new Set(duplicatedIds)).length : "无"}</span>
            <button type="button" className="small-primary-button" onClick={saveMembers}><UserCheck size={15} />保存小组名单</button>
            {memberMessage && <em>{memberMessage}</em>}
          </div>
        )}
        {!groupBuildEditing && memberMessage && <div className="member-audit compact-message"><em>{memberMessage}</em></div>}
      </section>

      <section className="panel cooperation-project-panel">
        <div className="panel-title">
          <div>
            <h2>合作项目</h2>
            <span>先呈现任务列表，点项目名称进入详情后补充目标、评价量表和各组表现</span>
          </div>
          <div className="project-filter-bar">
            <select value={projectFilters.type} onChange={(event) => setProjectFilters({ ...projectFilters, type: event.target.value })}>
              <option>全部</option>
              {["日常行规", "劳动卫生", "活动赛事", "课程学习"].map((type) => <option key={type}>{type}</option>)}
            </select>
            <select value={projectFilters.progress} onChange={(event) => setProjectFilters({ ...projectFilters, progress: event.target.value })}>
              {["全部", "未开始", "进行中", "已完成", "需跟进"].map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={projectFilters.sort} onChange={(event) => setProjectFilters({ ...projectFilters, sort: event.target.value })}>
              {["周期近到远", "名称", "类型", "进度"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>
        <form className="project-form" onSubmit={submitProject}>
          <input type="date" value={projectDraft.project_date} onChange={(event) => setProjectDraft({ ...projectDraft, project_date: event.target.value })} />
          <input type="date" value={projectDraft.end_date} onChange={(event) => setProjectDraft({ ...projectDraft, end_date: event.target.value })} />
          <select value={projectDraft.project_type} onChange={(event) => setProjectDraft({ ...projectDraft, project_type: event.target.value })}>
            {["日常行规", "劳动卫生", "活动赛事", "课程学习"].map((type) => <option key={type}>{type}</option>)}
          </select>
          <input className="wide-input" placeholder="项目名称" value={projectDraft.project_name} onChange={(event) => setProjectDraft({ ...projectDraft, project_name: event.target.value })} />
          <select value={projectDraft.progress} onChange={(event) => setProjectDraft({ ...projectDraft, progress: event.target.value })}>
            <option>未开始</option>
            <option>进行中</option>
            <option>已完成</option>
            <option>需跟进</option>
          </select>
          <select className="wide-input" value={projectDraft.division} onChange={(event) => setProjectDraft({ ...projectDraft, division: event.target.value })}>
            <option value="">选择分组方式</option>
            {groupingOptions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <button type="submit"><Plus size={16} />新增项目</button>
        </form>
        <div className="project-list">
          {projects.length === 0 && <div className="empty-row">暂无合作项目，可以先建立一个课程学习或劳动卫生项目。</div>}
          <div className="project-list-head"><b>时间周期</b><b>任务类型</b><b>名称</b><b>进度</b><b>操作</b></div>
          {filteredProjects.map((project) => {
            return (
            <article className="project-row" key={project.key}>
              <span>{project.period_label || project.project_date}</span>
              <span>{project.project_type}</span>
              <button type="button" className="project-name-button" onClick={() => setSelectedProjectKey(project.key)}>{project.project_name}</button>
              <small>{project.progress || "进行中"}</small>
              <div className="project-row-actions">
                <button type="button" onClick={() => startEditProject(project)}>修改</button>
                <button type="button" onClick={() => removeProject(project)}>删除</button>
              </div>
            </article>
            );
          })}
        </div>
        {selectedProjectKey && selectedProject && (
          <ProjectDetailModal
            project={editingProject || selectedProject}
            groups={buildGroups}
            members={members}
            personalScores={editingProject?.personal_scores || parseJson(selectedProject.personal_scores_json)}
            editable={Boolean(editingProject)}
            setProject={setEditingProject}
            onSave={saveProjectDetail}
            onEdit={() => startEditProject(selectedProject)}
            onClose={() => { setSelectedProjectKey(""); setEditingProject(null); }}
          />
        )}
      </section>

      <section className="panel student-cooperation-panel">
        <div className="panel-title">
          <div>
            <h2>合作战绩</h2>
            <span>可按时间、项目类型或具体项目筛选，并导出当前视图</span>
          </div>
          <div className="battle-toolbar">
            <input type="date" value={battleFilters.startDate} onChange={(event) => setBattleFilters({ ...battleFilters, startDate: event.target.value })} />
            <input type="date" value={battleFilters.endDate} onChange={(event) => setBattleFilters({ ...battleFilters, endDate: event.target.value })} />
            <select value={battleFilters.projectType} onChange={(event) => setBattleFilters({ ...battleFilters, projectType: event.target.value })}>
              <option>全部</option>
              {["日常行规", "劳动卫生", "活动赛事", "课程学习"].map((type) => <option key={type}>{type}</option>)}
            </select>
            <select value={battleFilters.projectKey} onChange={(event) => setBattleFilters({ ...battleFilters, projectKey: event.target.value })}>
              <option value="全部">全部项目</option>
              {projectScoreColumns.map((project) => <option value={project.key} key={project.key}>{project.project_name}</option>)}
            </select>
            <div className="segmented mini">
              <button type="button" className={battleView === "group" ? "active" : ""} onClick={() => setBattleView("group")}>小组</button>
              <button type="button" className={battleView === "list" ? "active" : ""} onClick={() => setBattleView("list")}>列表</button>
            </div>
            <button type="button" className="soft-button" onClick={() => openScoreEntry(battleView === "group" ? "group" : "student")}><Plus size={15} />新增分数</button>
            <button type="button" className="small-primary-button" onClick={exportBattleStats}><Download size={15} />导出</button>
          </div>
        </div>
        {battleView === "group" ? (
          <div className="group-battle-grid">
            {buildGroups.map((group, index) => {
              const stats = groupBattleStats.find((item) => String(item.group.id) === String(group.id)) || { group, memberIds: [], groupScore: 0, personalScore: 0, total: 0 };
              const rank = groupRankById.get(String(group.id));
              const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
              return (
                <article className={`group-battle-card rank-${rank || 0}`} key={group.id} style={{ "--group-color": group.color || "#1f67b1" }}>
                  <header>
                    <div>
                      <b>{index + 1}. {group.name}</b>
                      <span>{members.filter((member) => String(member.group_id) === String(group.id)).map((member) => member.name).join("、") || "暂无成员"}</span>
                    </div>
                    {medal && <strong className="medal-mark">{medal}</strong>}
                  </header>
                  <div className="battle-score-line">
                    <strong>{stats.total}</strong>
                    <span>合计得分</span>
                  </div>
                  <footer>
                    <span>小组 {stats.groupScore}</span>
                    <span>个人 {stats.personalScore}</span>
                  </footer>
                </article>
              );
            })}
            {!buildGroups.length && <div className="empty-row">暂无小组，请先在“小组建设”里建立分组。</div>}
          </div>
        ) : (
          <div className="cooperation-scorebook" style={{ "--project-count": Math.max(battleProjects.length + placeholderScoreColumns.length + 1, 1) }}>
            <div className="scorebook-head">
              <b>学号</b>
              <b>姓名</b>
              <b>合计</b>
              {battleProjects.map((project) => <b key={project.key}>{project.project_name}</b>)}
              {placeholderScoreColumns.map((item) => <b className="placeholder-score-col" key={item}>{item}</b>)}
            </div>
            {personalBattleRows.map((row) => (
              <div className="scorebook-row" key={row.student.id}>
                <span>{row.student.student_no || "-"}</span>
                <strong>{row.student.name}</strong>
                <span className="total-score-cell">{row.total}</span>
                {battleProjects.map((project) => {
                  const value = row.scoresByProject[project.key] || 0;
                  return <span className={value ? "" : "empty-score"} key={`${row.student.id}-${project.key}`}>{value || "-"}</span>;
                })}
                {placeholderScoreColumns.map((item) => <span className="empty-score placeholder-score-col" key={`${row.student.id}-${item}`}>-</span>)}
              </div>
            ))}
            {!battleProjects.length && <div className="empty-row">暂无符合筛选条件的合作项目。</div>}
          </div>
        )}
        {scoreEntry && (
          <ScoreEntryModal
            scoreEntry={scoreEntry}
            setScoreEntry={setScoreEntry}
            groupedProjects={groupedProjects}
            groups={buildGroups}
            members={members}
            classStudents={classStudents}
            updateScoreEntryProject={updateScoreEntryProject}
            onSave={saveScoreEntry}
            onClose={() => setScoreEntry(null)}
          />
        )}
      </section>

    </section>
  );
}

function ActivityToolsPage({ data }) {
  const [toolMode, setToolMode] = useState("");
  const [toolDraft, setToolDraft] = useState({ name: "", description: "", code: "" });
  const classes = Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean))).sort();
  return (
    <section className="activity-tools-page">
      <CooperationTools allStudents={data.students} classes={classes} defaultClass={data.scheduleMeta?.className} activeTool={toolMode} setActiveTool={setToolMode} />
      <section className="panel custom-tool-panel">
        <div className="panel-title">
          <div>
            <h2>新增小工具</h2>
            <span>代码语言：HTML。后续可接入为可运行工具</span>
          </div>
        </div>
        <div className="custom-tool-grid">
          <input placeholder="工具名称" value={toolDraft.name} onChange={(event) => setToolDraft({ ...toolDraft, name: event.target.value })} />
          <input placeholder="用途说明" value={toolDraft.description} onChange={(event) => setToolDraft({ ...toolDraft, description: event.target.value })} />
          <textarea
            value={toolDraft.code}
            onChange={(event) => setToolDraft({ ...toolDraft, code: event.target.value })}
            placeholder={`HTML 示例：
<button id="start">开始</button>
<script>
  const students = window.students || [];
  document.querySelector("#start").onclick = () => {
    alert(students[Math.floor(Math.random() * students.length)]?.name || "暂无学生");
  };
</script>`}
          />
        </div>
      </section>
    </section>
  );
}

function ProjectDetailModal({ project, groups, members, personalScores, editable, setProject, onSave, onEdit, onClose }) {
  const groupScoreMap = new Map((project.rows || []).map((row) => [String(row.group_id), Number(row.points || 0)]));
  const groupScores = editable ? project.group_scores || {} : Object.fromEntries(groupScoreMap);
  function updateProjectField(field, value) {
    if (!editable) return;
    setProject({ ...project, [field]: value });
  }
  function updateGroupScore(groupId, value) {
    setProject({ ...project, group_scores: { ...(project.group_scores || {}), [groupId]: value } });
  }
  function updatePersonalScore(studentId, value) {
    setProject({ ...project, personal_scores: { ...(project.personal_scores || {}), [studentId]: value } });
  }
  return (
    <div className="modal-backdrop work-area-backdrop">
      <section className="cell-editor project-detail-modal">
        <div className="panel-title">
          <div>
            <h2>{project.project_name}</h2>
            <span>{project.period_label || project.project_date} · {project.project_type} · {project.progress || "进行中"}</span>
          </div>
          <div className="modal-actions compact">
            {!editable && <button type="button" onClick={onEdit}>修改</button>}
            {editable && <button type="button" onClick={() => onSave(project)}>保存</button>}
            <button type="button" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="project-detail-block">
          <b>活动目标</b>
          {editable ? <textarea value={project.activity_detail || ""} onChange={(event) => updateProjectField("activity_detail", event.target.value)} placeholder="输入活动目标" /> : <p>{project.activity_detail || "暂无活动目标"}</p>}
        </div>
        <div className="project-detail-block">
          <b>分组方式</b>
          <p>{project.division || "暂无分工说明"}</p>
        </div>
        <div className="project-detail-block">
          <b>评价量表</b>
          {editable ? <textarea value={project.evaluation_note || ""} onChange={(event) => updateProjectField("evaluation_note", event.target.value)} placeholder="输入评价维度、等级描述或量表说明" /> : <p>{project.evaluation_note || "暂无评价量表"}</p>}
          <small>{project.evaluation_file_name || "未上传评价表附件"}</small>
        </div>
        <div className="project-detail-score-grid">
          {groups.map((group) => {
            const groupMembers = members.filter((member) => String(member.group_id) === String(group.id));
            return (
              <article className="project-score-card readonly" key={group.id} style={{ "--group-color": group.color }}>
                <div className="project-score-head">
                  <b>{group.name}</b>
                  {editable
                    ? <input type="number" value={groupScores[group.id] || ""} onChange={(event) => updateGroupScore(group.id, event.target.value)} placeholder="小组分" />
                    : <strong>{groupScores[String(group.id)] || 0} 分</strong>}
                </div>
                <div className="personal-score-grid readonly">
                  {groupMembers.map((member) => (
                    editable ? (
                      <label key={member.student_id}>
                        <span>{member.name}</span>
                        <input type="number" value={project.personal_scores?.[member.student_id] || ""} onChange={(event) => updatePersonalScore(member.student_id, event.target.value)} placeholder="个人分" />
                      </label>
                    ) : (
                      <span key={member.student_id}>
                        <em>{member.name}</em>
                        <b>{personalScores?.[member.student_id] || 0}</b>
                      </span>
                    )
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ScoreEntryModal({ scoreEntry, setScoreEntry, groupedProjects, groups, members, classStudents, updateScoreEntryProject, onSave, onClose }) {
  const project = scoreEntry.project;
  const groupScores = project.group_scores || {};
  const personalScores = project.personal_scores || {};

  function selectProject(key) {
    const next = groupedProjects.find((item) => item.key === key);
    if (!next) return;
    const [start, end] = String(next.period_label || "").split(/\s*至\s*/);
    let parsedPersonalScores = {};
    try {
      parsedPersonalScores = next.personal_scores_json ? JSON.parse(next.personal_scores_json) : {};
    } catch {
      parsedPersonalScores = {};
    }
    setScoreEntry({
      ...scoreEntry,
      project: {
        ...next,
        ids: next.rows.map((row) => row.id),
        project_date: start || next.project_date || todayIso(),
        end_date: end || next.project_date || todayIso(),
        group_scores: Object.fromEntries(next.rows.map((row) => [row.group_id, row.points || 0])),
        personal_scores: parsedPersonalScores
      }
    });
  }

  function updateGroupScore(groupId, value) {
    updateScoreEntryProject({ group_scores: { ...groupScores, [groupId]: value } });
  }

  function updatePersonalScore(studentId, value) {
    updateScoreEntryProject({ personal_scores: { ...personalScores, [studentId]: value } });
  }

  return (
    <div className="modal-backdrop work-area-backdrop">
      <form className="cell-editor score-entry-modal" onSubmit={onSave}>
        <div className="panel-title">
          <div>
            <h2>{scoreEntry.mode === "group" ? "按小组登记分数" : "按名单登记分数"}</h2>
            <span>保存后同步到项目详情和合作战绩</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="score-entry-toolbar">
          <label>合作项目<select value={project.key} onChange={(event) => selectProject(event.target.value)}>
            {groupedProjects.map((item) => <option key={item.key} value={item.key}>{item.project_date} · {item.project_name}</option>)}
          </select></label>
          <button type="button" className={scoreEntry.mode === "group" ? "is-active" : ""} onClick={() => setScoreEntry({ ...scoreEntry, mode: "group" })}>按小组</button>
          <button type="button" className={scoreEntry.mode === "student" ? "is-active" : ""} onClick={() => setScoreEntry({ ...scoreEntry, mode: "student" })}>按名单</button>
        </div>
        {scoreEntry.mode === "group" ? (
          <div className="score-entry-group-grid">
            {groups.map((group) => {
              const groupMembers = members.filter((member) => String(member.group_id) === String(group.id));
              return (
                <article key={group.id} style={{ "--group-color": group.color || "#1f67b1" }}>
                  <b>{group.name}</b>
                  <span>{groupMembers.map((member) => member.name).join("、") || "暂无成员"}</span>
                  <input type="number" value={groupScores[group.id] || ""} onChange={(event) => updateGroupScore(group.id, event.target.value)} placeholder="小组得分" />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="score-entry-student-table">
            <div className="score-entry-student-head"><b>学号</b><b>姓名</b><b>小组</b><b>个人得分</b></div>
            {classStudents.map((student) => {
              const member = members.find((item) => String(item.student_id) === String(student.id));
              const group = groups.find((item) => String(item.id) === String(member?.group_id));
              return (
                <div className="score-entry-student-row" key={student.id}>
                  <span>{student.student_no || "-"}</span>
                  <b>{student.name}</b>
                  <span>{group?.name || "-"}</span>
                  <input type="number" value={personalScores[student.id] || ""} onChange={(event) => updatePersonalScore(student.id, event.target.value)} placeholder="个人得分" />
                </div>
              );
            })}
          </div>
        )}
        <button type="submit"><Save size={16} />保存分数</button>
      </form>
    </div>
  );
}

const DEFAULT_LOTTERY_PRIZES = ["免一次值日", "课堂表扬", "优先选座", "积分 +2", "语文朗读官", "小组奖励", "积分 +1", "神秘任务", "再抽一次"];

function loadLotteryPrizes() {
  try {
    const saved = window.localStorage?.getItem("lotteryPrizes");
    const parsed = saved ? JSON.parse(saved) : null;
    if (Array.isArray(parsed) && parsed.length >= 4) return parsed;
  } catch {
    // 忽略本地存储读取失败，使用默认奖品
  }
  return DEFAULT_LOTTERY_PRIZES;
}

function CooperationTools({ allStudents, classes, defaultClass, activeTool, setActiveTool }) {
  const [selectedClass, setSelectedClass] = useState(classes.includes(defaultClass) ? defaultClass : classes[0] || "");
  const students = useMemo(() => allStudents.filter((student) => student.class_name === selectedClass), [allStudents, selectedClass]);
  const [picked, setPicked] = useState([]);
  const [pickCount, setPickCount] = useState(3);
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [timerRunning, setTimerRunning] = useState(false);
  const [lotteryIndex, setLotteryIndex] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [prizes, setPrizes] = useState(loadLotteryPrizes);
  const [editingPrizes, setEditingPrizes] = useState(false);
  const [prizeDraft, setPrizeDraft] = useState(() => loadLotteryPrizes().join("、"));
  const spinTimerRef = useRef(null);
  const tools = [
    ["random", Shuffle, "随机点名"],
    ["multi", TargetIcon, "多人点名"],
    ["timer", Timer, "计时器"],
    ["lottery", Gift, "九宫格抽奖"]
  ];

  useEffect(() => {
    if (!timerRunning) return undefined;
    const id = window.setInterval(() => {
      setTimerSeconds((value) => {
        if (value <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  useEffect(() => () => { if (spinTimerRef.current) window.clearInterval(spinTimerRef.current); }, []);

  function stopSpin() {
    if (spinTimerRef.current) {
      window.clearInterval(spinTimerRef.current);
      spinTimerRef.current = null;
    }
    setSpinning(false);
  }

  // 名字先跳动一会儿再定格：最终结果一开始就算好，滚动过程只是视觉效果，不会影响真正抽到的人
  function randomStudents(count = 1) {
    if (!students.length || spinning) return;
    const pool = [...students];
    const finalResult = [];
    while (pool.length && finalResult.length < count) {
      const index = Math.floor(Math.random() * pool.length);
      finalResult.push(pool.splice(index, 1)[0]);
    }
    setSpinning(true);
    let ticks = 0;
    const maxTicks = 14;
    spinTimerRef.current = window.setInterval(() => {
      ticks += 1;
      const shuffled = [...students].sort(() => Math.random() - 0.5).slice(0, count);
      setPicked(shuffled);
      if (ticks >= maxTicks) {
        stopSpin();
        setPicked(finalResult);
      }
    }, 90);
  }

  // 九宫格先按顺序快速点选一会儿（类似老虎机），再停在真正抽中的格子上
  function startLottery() {
    if (!prizes.length || spinning) return;
    const finalIndex = Math.floor(Math.random() * prizes.length);
    setSpinning(true);
    let ticks = 0;
    let current = lotteryIndex ?? 0;
    const maxTicks = 20;
    spinTimerRef.current = window.setInterval(() => {
      current = (current + 1) % prizes.length;
      setLotteryIndex(current);
      ticks += 1;
      if (ticks >= maxTicks) {
        stopSpin();
        setLotteryIndex(finalIndex);
      }
    }, 110);
  }

  function savePrizes() {
    const next = prizeDraft.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
    if (next.length < 4) {
      window.alert("奖品至少需要 4 个，请用顿号、逗号或换行分隔。");
      return;
    }
    setPrizes(next);
    setLotteryIndex(null);
    setEditingPrizes(false);
    try {
      window.localStorage?.setItem("lotteryPrizes", JSON.stringify(next));
    } catch {
      // 本地存储不可用时静默忽略，奖品仍在本次会话中生效
    }
  }

  const minutes = String(Math.floor(timerSeconds / 60)).padStart(2, "0");
  const seconds = String(timerSeconds % 60).padStart(2, "0");

  return (
    <section className="panel cooperation-tools-panel">
      <div className="panel-title">
        <div>
          <h2>工具箱</h2>
          <span>从班级积分系统移入的四个课堂工具</span>
        </div>
        <select className="class-switcher" value={selectedClass} onChange={(event) => { setSelectedClass(event.target.value); setPicked([]); }}>
          {classes.map((className) => <option key={className}>{className}</option>)}
        </select>
      </div>
      <div className="toolbox-grid">
        {tools.map(([key, Icon, label]) => (
          <button type="button" key={key} onClick={() => { setPicked([]); setActiveTool(key); }}>
            <Icon size={32} />
            <b>{label}</b>
          </button>
        ))}
      </div>

      {activeTool && createPortal(
        <div className="modal-backdrop toolbox-backdrop">
          <section className="cell-editor toolbox-modal">
            <div className="panel-title">
              <h2>{tools.find(([key]) => key === activeTool)?.[2]} · {selectedClass}</h2>
              <button type="button" onClick={() => { stopSpin(); setActiveTool(""); setTimerRunning(false); }}>关闭</button>
            </div>
            {activeTool === "random" && (
              <>
                <div className={`picker-result ${spinning ? "is-spinning" : ""}`}>{picked[0] ? `${picked[0].student_no}. ${picked[0].name}` : "点击开始点名"}</div>
                <button type="button" disabled={spinning || !students.length} onClick={() => randomStudents(1)}><Shuffle size={16} />{spinning ? "点名中…" : "开始点名"}</button>
                {!students.length && <small>该班暂无学生名单</small>}
              </>
            )}
            {activeTool === "multi" && (
              <>
                <label>点名人数<input type="number" min="1" max={students.length || 1} value={pickCount} onChange={(event) => setPickCount(Number(event.target.value))} /></label>
                <button type="button" disabled={spinning || !students.length} onClick={() => randomStudents(pickCount)}><UserCheck size={16} />{spinning ? "点名中…" : "开始点名"}</button>
                <div className={`multi-result ${spinning ? "is-spinning" : ""}`}>{picked.map((student) => <small key={student.id}>{student.student_no}. {student.name}</small>)}</div>
              </>
            )}
            {activeTool === "timer" && (
              <>
                <label>计时秒数<input type="number" min="0" value={timerSeconds} onChange={(event) => setTimerSeconds(Number(event.target.value))} /></label>
                <div className="timer-display">{minutes}:{seconds}</div>
                <div className="timer-actions">
                  <button type="button" onClick={() => setTimerRunning(true)}>开始</button>
                  <button type="button" onClick={() => setTimerRunning(false)}>暂停</button>
                  <button type="button" onClick={() => { setTimerRunning(false); setTimerSeconds(300); }}>重置</button>
                </div>
              </>
            )}
            {activeTool === "lottery" && (
              <>
                <div className="lottery-grid">
                  {prizes.map((prize, index) => <span className={lotteryIndex === index ? "is-active" : ""} key={`${prize}-${index}`}>{prize}</span>)}
                </div>
                <div className="lottery-actions">
                  <button type="button" disabled={spinning} onClick={startLottery}><Trophy size={16} />{spinning ? "抽奖中…" : "开始抽奖"}</button>
                  <button type="button" className="subtle-button" disabled={spinning} onClick={() => setEditingPrizes((value) => !value)}>{editingPrizes ? "收起" : "自定义奖品"}</button>
                </div>
                {editingPrizes && (
                  <div className="lottery-prize-editor">
                    <textarea value={prizeDraft} onChange={(event) => setPrizeDraft(event.target.value)} placeholder="用顿号、逗号或换行分隔每个奖品，至少 4 个" />
                    <button type="button" className="small-primary-button" onClick={savePrizes}><Save size={15} />保存奖品</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>,
        document.body
      )}
    </section>
  );
}

const TargetIcon = Trophy;

function HomePage({
  data,
  setActivePage,
  setActiveWorkspace,
  todoDraft,
  setTodoDraft,
  addClassTodo,
  updateClassTodo,
  deleteClassTodo,
  updateSubjectPlan,
  deleteSubjectPlan,
  updateHomework,
  deleteHomework,
  updateRecitation,
  deleteRecitation,
  updateAssessment,
  deleteAssessment
}) {
  const [studentNameInput, setStudentNameInput] = useState("");
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(monthIso(todayIso()));
  const [calendarRange, setCalendarRange] = useState("month");
  const [editingDate, setEditingDate] = useState(null);
  const homeStudentPickerRef = useRef(null);
  useClickOutside(homeStudentPickerRef, () => setShowStudentPicker(false), showStudentPicker);
  const [homeDetailKey, setHomeDetailKey] = useState(null);
  const totalStudents = data.students.length;
  const todayLeaveStudentIds = new Set((data.leaveRecords || []).filter((item) => item.leave_date === todayIso()).map((item) => String(item.student_id)));
  const presentCount = Math.max(0, totalStudents - todayLeaveStudentIds.size);
  const cards = [
    { key: "attendance", label: "今日出勤", value: `${presentCount}/${totalStudents}`, note: todayLeaveStudentIds.size ? `${todayLeaveStudentIds.size} 人请假` : "今日无请假记录" },
    { key: "hours", label: "本周总课时", value: data.scheduleStats.weeklyTotal, note: "班级课表 + 个人课表" },
    { key: "todos", label: "待办事项", value: data.classTodos?.length || 0, note: "最新 15 项班级事务" },
    { key: "family", label: "家校沟通", value: data.familyStats.total, note: `${data.familyStats.pending} 条需跟进` }
  ];
  const todayBirthdayStudents = data.students.filter((student) => {
    if (!student.birth_date) return false;
    const parts = String(student.birth_date).split(/[-/]/);
    if (parts.length < 3) return false;
    const today = new Date();
    return Number(parts[1]) === today.getMonth() + 1 && Number(parts[2]) === today.getDate();
  });

  const selectedStudentIds = (todoDraft.student_ids || []).map(String);
  const selectedTodoStudents = data.students.filter((student) => selectedStudentIds.includes(String(student.id)));
  const calendarDays = calendarRange === "month"
    ? buildMonthDays(calendarMonth)
    : Array.from({ length: Number(calendarRange) }, (_, index) => {
      const iso = addDays(mondayOfWeek(todayIso()), index);
      return { iso, day: Number(iso.slice(8, 10)), isCurrentMonth: iso.slice(0, 7) === calendarMonth, weekday: weekdayLabel(iso) };
    });
  const scheduleEvents = [
    ...(data.classTodos || []).map((item) => ({
      id: `todo-${item.id}`,
      date: item.todo_date,
      title: item.title,
      kind: item.area === "其他" ? "other" : "class",
      label: item.area === "其他" ? "其他" : "班级",
      source: "classTodo",
      raw: item
    })),
    ...(data.subject?.plans || []).map((item) => ({
      id: `plan-${item.id}`,
      date: item.plan_date,
      title: item.lesson_title,
      kind: item.lesson_type === "学科测试" ? "assessment" : "teaching",
      label: item.lesson_type === "学科测试" ? "测评" : "教学",
      source: "plan",
      raw: item
    })),
    ...(data.subject?.homework || []).map((item) => ({
      id: `homework-${item.id}`,
      date: item.assign_date || item.due_date,
      title: item.title,
      kind: "homework",
      label: "作业",
      source: "homework",
      raw: item
    })),
    ...(data.subject?.recitations || []).map((item) => ({
      id: `recitation-${item.id}`,
      date: item.assign_date || item.due_date,
      title: item.title,
      kind: "recitation",
      label: "背默",
      source: "recitation",
      raw: item
    })),
    ...(data.subject?.assessments || []).map((item) => ({
      id: `assessment-${item.id}`,
      date: item.test_date,
      title: item.title,
      kind: "assessment",
      label: "测评",
      source: "assessment",
      raw: item
    }))
  ].filter((item) => item.date && item.title);
  const eventsByDate = scheduleEvents.reduce((map, item) => {
    if (!map[item.date]) map[item.date] = [];
    map[item.date].push(item);
    return map;
  }, {});

  function updateTodoStudents(nextIds) {
    setTodoDraft({ ...todoDraft, student_ids: Array.from(new Set(nextIds.map(String))) });
  }

  function addTodoStudentByName() {
    const keyword = studentNameInput.trim();
    if (!keyword) return;
    const matched = data.students.find((student) => student.name === keyword)
      || data.students.find((student) => student.name?.includes(keyword))
      || data.students.find((student) => `${student.student_no}` === keyword);
    if (!matched) return;
    updateTodoStudents([...selectedStudentIds, String(matched.id)]);
    setStudentNameInput("");
  }

  async function saveCalendarEvent(eventItem, patch) {
    if (eventItem.source === "classTodo") {
      return updateClassTodo({ ...eventItem.raw, ...patch, todo_date: patch.date || eventItem.raw.todo_date, title: patch.title ?? eventItem.raw.title });
    }
    if (eventItem.source === "plan") {
      return updateSubjectPlan(eventItem.raw, {
        plan_date: patch.date || eventItem.raw.plan_date,
        lesson_title: patch.title ?? eventItem.raw.lesson_title,
        lesson_goal: patch.requirement ?? eventItem.raw.lesson_goal,
        note: patch.detail ?? eventItem.raw.note
      });
    }
    if (eventItem.source === "homework") {
      return updateHomework(eventItem.raw, {
        assign_date: patch.date || eventItem.raw.assign_date,
        due_date: patch.date || eventItem.raw.due_date,
        title: patch.title ?? eventItem.raw.title,
        note: patch.detail ?? eventItem.raw.note
      });
    }
    if (eventItem.source === "recitation") {
      return updateRecitation(eventItem.raw, {
        assign_date: patch.date || eventItem.raw.assign_date,
        due_date: patch.date || eventItem.raw.due_date,
        title: patch.title ?? eventItem.raw.title,
        content: patch.requirement ?? eventItem.raw.content,
        note: patch.detail ?? eventItem.raw.note
      });
    }
    if (eventItem.source === "assessment") {
      return updateAssessment({
        ...eventItem.raw,
        test_date: patch.date || eventItem.raw.test_date,
        title: patch.title ?? eventItem.raw.title,
        note: patch.detail ?? eventItem.raw.note
      });
    }
    return null;
  }

  async function deleteCalendarEvent(eventItem) {
    if (eventItem.source === "classTodo") return deleteClassTodo({ id: eventItem.raw.id });
    if (eventItem.source === "plan") return deleteSubjectPlan(eventItem.raw);
    if (eventItem.source === "homework") return deleteHomework(eventItem.raw);
    if (eventItem.source === "recitation") return deleteRecitation(eventItem.raw);
    if (eventItem.source === "assessment") return deleteAssessment({ id: eventItem.raw.id });
    return null;
  }

  return (
    <section className="page-grid home-layout">
      <div className="metric-row">
        {cards.map((card) => (
          <button type="button" className="metric-card metric-card-clickable" key={card.label} onClick={() => setHomeDetailKey(card.key)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </button>
        ))}
      </div>

      <section className="panel home-calendar-panel">
        <div className="panel-title">
          <div>
            <h2>日程表</h2>
            <span>班级事务与教学事务统一呈现，点击日期可在右侧新增事项</span>
          </div>
          <div className="home-calendar-toolbar">
            <input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} />
            <select value={calendarRange} onChange={(event) => setCalendarRange(event.target.value)}>
              <option value="month">当月</option>
              <option value="7">本周</option>
              <option value="14">两周</option>
              <option value="21">三周</option>
              <option value="28">四周</option>
            </select>
          </div>
        </div>
        <div className={`home-calendar-grid ${calendarRange === "month" ? "" : "is-range"}`}>
          {calendarRange === "month" && ["一", "二", "三", "四", "五", "六", "日"].map((day) => <b className="month-weekday" key={day}>周{day}</b>)}
          {calendarDays.map((day) => {
            const items = eventsByDate[day.iso] || [];
            const dayOfWeek = dateFromIso(day.iso).getDay();
            return (
              <button
                type="button"
                className={`home-calendar-day ${day.isCurrentMonth ? "" : "is-outside"} ${dayOfWeek === 0 || dayOfWeek === 6 ? "is-weekend" : ""} ${day.iso === todayIso() ? "is-today" : ""} ${todoDraft.todo_date === day.iso ? "is-selected" : ""}`}
                key={day.iso}
                onClick={() => setTodoDraft({ ...todoDraft, todo_date: day.iso })}
                onDoubleClick={() => setEditingDate(day.iso)}
              >
                <span className="home-calendar-date"><b>{day.day}</b><small>{calendarRange === "month" ? "" : day.weekday}</small></span>
                <div>
                  {items.slice(0, 5).map((item) => (
                    <span className={`schedule-chip ${item.kind}`} key={item.id}>{item.label} · {item.title}</span>
                  ))}
                  {items.length > 5 && <small className="more-chip">还有 {items.length - 5} 项</small>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="panel timeline-panel">
        <div className="panel-title">
          <h2>新增待办事项</h2>
          <span>班主任事务与教学事务统一新增</span>
        </div>
        {todayBirthdayStudents.length > 0 && (
          <div className="birthday-banner">
            <Gift size={16} />
            <span>今日寿星：{todayBirthdayStudents.map((student) => student.name).join("、")}</span>
          </div>
        )}
        <form className="todo-form" onSubmit={addClassTodo}>
          <input type="date" value={todoDraft.todo_date} onChange={(event) => setTodoDraft({ ...todoDraft, todo_date: event.target.value })} />
          <select value={todoDraft.area || "班主任"} onChange={(event) => setTodoDraft({ ...todoDraft, area: event.target.value })}>
            <option>班主任</option>
            <option>教学</option>
            <option>其他</option>
          </select>
          {todoDraft.area === "教学" && (
            <>
              <select value={todoDraft.teaching_kind || "教学"} onChange={(event) => setTodoDraft({ ...todoDraft, teaching_kind: event.target.value })}>
                <option>教学</option>
                <option>作业</option>
                <option>背默</option>
                <option>测评</option>
              </select>
              <select value={todoDraft.class_name || ""} onChange={(event) => setTodoDraft({ ...todoDraft, class_name: event.target.value })}>
                <option value="">5班、6班同步</option>
                {(data.appConfig.teachingClasses || []).map((className) => <option key={className}>{className}</option>)}
              </select>
            </>
          )}
          <input placeholder="待办事项" value={todoDraft.title} onChange={(event) => setTodoDraft({ ...todoDraft, title: event.target.value })} />
          <input placeholder="要求（选填）" value={todoDraft.requirement} onChange={(event) => setTodoDraft({ ...todoDraft, requirement: event.target.value })} />
          <textarea placeholder={todoDraft.area === "教学" ? "补充说明 / 资料说明（选填）" : "详情（选填，可同步到家校沟通）"} value={todoDraft.detail} onChange={(event) => setTodoDraft({ ...todoDraft, detail: event.target.value })} />
          <label className="attach-button full-click-upload"><Paperclip size={15} />凭证 / 资料
            <input type="file" onChange={(event) => setTodoDraft({ ...todoDraft, credential_path: event.target.files?.[0]?.path || "" })} />
          </label>
          {todoDraft.area !== "教学" && (
            <>
              <label className="inline-check"><input type="checkbox" checked={todoDraft.sync_work_log} onChange={(event) => setTodoDraft({ ...todoDraft, sync_work_log: event.target.checked })} />同步工作留痕</label>
              {todoDraft.area !== "其他" && <label className="inline-check"><input type="checkbox" checked={todoDraft.sync_family} onChange={(event) => setTodoDraft({ ...todoDraft, sync_family: event.target.checked })} />同步家校沟通</label>}
            </>
          )}
          {todoDraft.area === "班主任" && todoDraft.sync_family && (
            <>
              <div className="todo-student-picker-wrap" ref={homeStudentPickerRef}>
                <div className="todo-student-input-area">
                  <div className="todo-student-input-row">
                    <input
                      list="todo-student-options"
                      placeholder="输入学生姓名，回车添加"
                      value={studentNameInput}
                      onChange={(event) => setStudentNameInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTodoStudentByName();
                        }
                      }}
                    />
                    <datalist id="todo-student-options">
                      {data.students.map((student) => <option value={student.name} key={student.id}>{student.class_name} {student.student_no}</option>)}
                    </datalist>
                    <button type="button" className="soft-button" onClick={addTodoStudentByName}>添加</button>
                    <button type="button" className="soft-button" onClick={() => setShowStudentPicker((value) => !value)}>{showStudentPicker ? "收起名单" : "查看名单勾选"}</button>
                  </div>
                  <div className="todo-student-tags">
                    {selectedTodoStudents.length === 0 && <span>尚未选择学生</span>}
                    {selectedTodoStudents.map((student) => (
                      <button type="button" key={student.id} onClick={() => updateTodoStudents(selectedStudentIds.filter((id) => id !== String(student.id)))}>
                        {student.name}<small>×</small>
                      </button>
                    ))}
                  </div>
                </div>
                {showStudentPicker && (
                  <div className="todo-student-checks">
                    {data.students.map((student) => {
                      const selected = selectedStudentIds.includes(String(student.id));
                      return (
                        <label className={selected ? "is-checked" : ""} key={student.id}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              const next = event.target.checked ? [...selectedStudentIds, String(student.id)] : selectedStudentIds.filter((id) => id !== String(student.id));
                              updateTodoStudents(next);
                            }}
                          />
                          {student.class_name.replace("预备", "")}.{student.student_no} {student.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="inline-check"><input type="checkbox" checked={todoDraft.is_leave} onChange={(event) => setTodoDraft({ ...todoDraft, is_leave: event.target.checked })} />是否请假</label>
              {todoDraft.is_leave && (
                <div className="leave-inline-fields">
                  <label>请假时段<select
                    value={["全天", "上午", "下午"].includes(todoDraft.leave_period) ? todoDraft.leave_period : "自定义"}
                    onChange={(event) => setTodoDraft({ ...todoDraft, leave_period: event.target.value === "自定义" ? "" : event.target.value })}
                  ><option>全天</option><option>上午</option><option>下午</option><option>自定义</option></select></label>
                  {!["全天", "上午", "下午"].includes(todoDraft.leave_period) && (
                    <label>自定义时段<input value={todoDraft.leave_period} onChange={(event) => setTodoDraft({ ...todoDraft, leave_period: event.target.value })} placeholder="如 8:00-10:30" /></label>
                  )}
                  <label>类型<select value={todoDraft.leave_type} onChange={(event) => setTodoDraft({ ...todoDraft, leave_type: event.target.value })}><option>病假</option><option>事假</option><option>其他</option></select></label>
                  <label>备注<input value={todoDraft.leave_remark} onChange={(event) => setTodoDraft({ ...todoDraft, leave_remark: event.target.value })} /></label>
                </div>
              )}
            </>
          )}
          <button type="submit"><Plus size={16} />新增事项</button>
        </form>
        <div className="todo-list">
          {scheduleEvents
            .sort((a, b) => String(b.raw?.created_at || b.date || "").localeCompare(String(a.raw?.created_at || a.date || "")))
            .map((todo) => (
            <div className="trace-row" key={todo.id}>
              <b>{todo.date} · {todo.title}</b>
              <span><em className={`schedule-chip ${todo.kind}`}>{todo.label}</em></span>
            </div>
          ))}
        </div>
      </aside>
      {homeDetailKey && (
        <HomeCardDetailModal
          cardKey={homeDetailKey}
          data={data}
          onClose={() => setHomeDetailKey(null)}
          onGoFamily={() => {
            setHomeDetailKey(null);
            setActivePage("family");
          }}
        />
      )}
      {editingDate && (
        <HomeCalendarDayModal
          data={data}
          date={editingDate}
          events={(eventsByDate[editingDate] || [])}
          onClose={() => setEditingDate(null)}
          onAdd={addClassTodo}
          onSave={saveCalendarEvent}
          onDelete={deleteCalendarEvent}
        />
      )}
    </section>
  );
}

function HomeCardDetailModal({ cardKey, data, onClose, onGoFamily }) {
  const today = todayIso();
  let title = "";
  let body = null;

  if (cardKey === "attendance") {
    title = "今日出勤详情";
    const todayLeaves = (data.leaveRecords || []).filter((item) => item.leave_date === today);
    body = todayLeaves.length === 0 ? (
      <div className="empty-row">今日暂无请假记录。</div>
    ) : (
      <div className="home-detail-list">
        {todayLeaves.map((item) => (
          <div className="home-detail-row" key={item.id}>
            <b>{item.student_name}</b>
            <span>{item.class_name} · {item.leave_type} · {item.period_label}</span>
            <small>{item.remark || "无备注"}</small>
          </div>
        ))}
      </div>
    );
  } else if (cardKey === "hours") {
    title = "本周课时分布";
    const byDay = days.map((label, index) => {
      const cells = (data.schedules?.personal || [])
        .filter((cell) => cell.title && Number(cell.day_index) === index)
        .sort((a, b) => Number(a.period_index) - Number(b.period_index));
      return { label, cells };
    });
    body = (
      <div className="home-schedule-detail">
        {byDay.map((day) => (
          <article className="home-schedule-day" key={day.label}>
            <h3>{day.label}<small>{day.cells.length} 节</small></h3>
            {day.cells.length === 0 && <span className="muted-line">暂无排课</span>}
            {day.cells.map((cell) => (
              <div className="home-schedule-item" key={`${cell.day_index}-${cell.period_index}-${cell.title}`}>
                <b>{periodLabels[Number(cell.period_index)] || cell.period_index}节</b>
                <span>{cell.title}</span>
                <small>{cell.time_label || "未填时间"}</small>
              </div>
            ))}
          </article>
        ))}
      </div>
    );
  } else if (cardKey === "todos") {
    title = "班级待办事项";
    const todos = data.classTodos || [];
    body = todos.length === 0 ? (
      <div className="empty-row">暂无待办事项。</div>
    ) : (
      <div className="home-detail-list">
        {todos.map((todo) => (
          <div className="home-detail-row" key={todo.id}>
            <b>{todo.todo_date} · {todo.title}</b>
            <span>{[todo.requirement, todo.detail].filter(Boolean).join(" · ") || "暂无详情"}</span>
          </div>
        ))}
      </div>
    );
  } else if (cardKey === "family") {
    title = "家校沟通概览";
    const recent = [...(data.familyCommunications || [])]
      .sort((a, b) => String(b.communication_date || "").localeCompare(String(a.communication_date || "")))
      .slice(0, 10);
    body = (
      <>
        <div className="home-detail-list">
          {recent.length === 0 && <div className="empty-row">暂无家校沟通记录。</div>}
          {recent.map((item) => (
            <div className="home-detail-row" key={item.id}>
              <b>{item.communication_date} · {item.title}</b>
              <span>{item.student_name || "未关联学生"} · {item.category} · {item.status}</span>
            </div>
          ))}
        </div>
        <button type="button" className="small-primary-button" onClick={onGoFamily}>前往家校沟通页</button>
      </>
    );
  }

  return createPortal(
    <div className="modal-backdrop work-area-backdrop" onClick={onClose}>
      <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div><h2>{title}</h2></div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        {body}
      </section>
    </div>,
    document.body
  );
}

function eventToDraft(eventItem) {
  const raw = eventItem.raw || {};
  if (eventItem.source === "classTodo") {
    return {
      date: raw.todo_date || eventItem.date,
      title: raw.title || "",
      requirement: raw.requirement || "",
      detail: raw.detail || ""
    };
  }
  if (eventItem.source === "plan") {
    return {
      date: raw.plan_date || eventItem.date,
      title: raw.lesson_title || "",
      requirement: raw.lesson_goal || "",
      detail: raw.note || ""
    };
  }
  if (eventItem.source === "homework") {
    return {
      date: raw.assign_date || raw.due_date || eventItem.date,
      title: raw.title || "",
      requirement: raw.homework_type || "",
      detail: raw.note || ""
    };
  }
  if (eventItem.source === "recitation") {
    return {
      date: raw.assign_date || raw.due_date || eventItem.date,
      title: raw.title || "",
      requirement: raw.content || "",
      detail: raw.note || ""
    };
  }
  return {
    date: raw.test_date || eventItem.date,
    title: raw.title || "",
    requirement: raw.test_type || "",
    detail: raw.note || ""
  };
}

function HomeCalendarDayModal({ data, date, events, onClose, onAdd, onSave, onDelete }) {
  const [quickDraft, setQuickDraft] = useState({
    todo_date: date,
    area: "班主任",
    teaching_kind: "教学",
    class_name: "",
    title: "",
    requirement: "",
    detail: "",
    sync_work_log: true,
    sync_family: false,
    student_ids: []
  });
  const [drafts, setDrafts] = useState(() => Object.fromEntries(events.map((item) => [item.id, eventToDraft(item)])));

  useEffect(() => {
    setQuickDraft((current) => ({ ...current, todo_date: date }));
    setDrafts(Object.fromEntries(events.map((item) => [item.id, eventToDraft(item)])));
  }, [date, events.length]);

  async function submitQuick(event) {
    await onAdd(event, quickDraft);
    setQuickDraft((current) => ({ ...current, title: "", requirement: "", detail: "" }));
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <section className="detail-modal calendar-day-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <h2>{date} · {weekdayLabel(date)}</h2>
            <span>双击日期后的事项管理：可新增、修改、删除</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <form className="calendar-quick-form" onSubmit={submitQuick}>
          <select value={quickDraft.area} onChange={(event) => setQuickDraft({ ...quickDraft, area: event.target.value })}><option>班主任</option><option>教学</option><option>其他</option></select>
          {quickDraft.area === "教学" && (
            <>
              <select value={quickDraft.teaching_kind} onChange={(event) => setQuickDraft({ ...quickDraft, teaching_kind: event.target.value })}><option>教学</option><option>作业</option><option>背默</option><option>测评</option></select>
              <select value={quickDraft.class_name} onChange={(event) => setQuickDraft({ ...quickDraft, class_name: event.target.value })}>
                <option value="">5班、6班同步</option>
                {(data.appConfig.teachingClasses || []).map((className) => <option key={className}>{className}</option>)}
              </select>
            </>
          )}
          <input value={quickDraft.title} onChange={(event) => setQuickDraft({ ...quickDraft, title: event.target.value })} placeholder="新增事项标题" />
          <input value={quickDraft.requirement} onChange={(event) => setQuickDraft({ ...quickDraft, requirement: event.target.value })} placeholder="要求 / 内容（选填）" />
          <button type="submit"><Plus size={15} />新增</button>
        </form>
        <div className="calendar-day-event-list">
          {events.length === 0 && <div className="empty-row">这一天还没有事项，可从上方新增。</div>}
          {events.map((item) => {
            const draft = drafts[item.id] || eventToDraft(item);
            return (
              <article className="calendar-day-event-row" key={item.id}>
                <span className={`schedule-chip ${item.kind}`}>{item.label}</span>
                <input type="date" value={draft.date} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, date: event.target.value } })} />
                <input value={draft.title} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, title: event.target.value } })} />
                <input value={draft.requirement} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, requirement: event.target.value } })} placeholder="要求/内容" />
                <input value={draft.detail} onChange={(event) => setDrafts({ ...drafts, [item.id]: { ...draft, detail: event.target.value } })} placeholder="说明" />
                <div>
                  <button type="button" onClick={() => onSave(item, draft)}><Save size={14} />保存</button>
                  <button type="button" className="danger-soft-button" onClick={() => onDelete(item)}><Trash2 size={14} />删除</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>,
    document.body
  );
}

const WORK_LOG_STATUS_OPTIONS = ["未开始", "进行中", "已完成"];

function workLogStatusKey(status) {
  if (status === "进行中") return "doing";
  if (status === "已完成") return "done";
  return "pending";
}

function splitTags(value) {
  return String(value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

function WorkLogsPage({ data, addWorkLog, updateWorkLog, deleteWorkLog }) {
  const emptyDraft = { log_date: todayIso(), title: "", type: "班级管理", status: "未开始", tags: "", remark: "", requirement: "", evidence_path: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [detailLog, setDetailLog] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const logs = data.logs || [];
  const allTags = Array.from(new Set(logs.flatMap((log) => splitTags(log.tags))));
  const filteredLogs = logs.filter((log) => {
    if (filterStatus !== "all" && (log.status || "未开始") !== filterStatus) return false;
    if (filterTag !== "all" && !splitTags(log.tags).includes(filterTag)) return false;
    return true;
  });

  function startEdit(log, event) {
    event.stopPropagation();
    setEditingId(log.id);
    setEditDraft({
      log_date: log.log_date || todayIso(),
      title: log.title || "",
      type: log.type || "班级管理",
      status: log.status || "未开始",
      tags: log.tags || "",
      remark: log.remark || "",
      requirement: log.requirement || "",
      evidence_path: "",
      evidence_file_id: log.evidence_file_id || null
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (!draft.title.trim()) {
      window.alert("请先填写事项内容");
      return;
    }
    try {
      await addWorkLog(draft);
      setDraft(emptyDraft);
    } catch {
      // 错误提示已在 addWorkLog 中弹出
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editDraft.title.trim()) {
      window.alert("请先填写事项内容");
      return;
    }
    try {
      await updateWorkLog({ ...editDraft, id: editingId });
      cancelEdit();
    } catch {
      // 错误提示已在 updateWorkLog 中弹出
    }
  }

  async function removeLog(log, event) {
    event.stopPropagation();
    if (!window.confirm(`确定删除"${log.title}"这条记录吗？`)) return;
    try {
      await deleteWorkLog({ id: log.id });
      if (detailLog?.id === log.id) setDetailLog(null);
      if (editingId === log.id) cancelEdit();
    } catch {
      // 错误提示已在 deleteWorkLog 中弹出
    }
  }

  return (
    <section className="page-grid work-log-page">
      <section className="panel work-log-form-panel">
        <div className="panel-title">
          <div>
            <h2>新增工作留痕</h2>
            <span>日期、事项、状态、标签、备注都可以自由填写；要求和凭证会显示在详情里</span>
          </div>
        </div>
        <form className="work-log-form" onSubmit={submit}>
          <label className="dated-field"><span>日期</span><input type="date" value={draft.log_date} onChange={(event) => setDraft({ ...draft, log_date: event.target.value })} /></label>
          <input placeholder="事项" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            {WORK_LOG_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
          </select>
          <input
            placeholder="标签，用顿号分隔，如：德育、安全"
            value={draft.tags}
            onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            list="work-log-tag-options"
          />
          <datalist id="work-log-tag-options">{allTags.map((tag) => <option value={tag} key={tag} />)}</datalist>
          <input placeholder="备注" value={draft.remark} onChange={(event) => setDraft({ ...draft, remark: event.target.value })} />
          <textarea placeholder="要求（选填，会显示在详情页）" value={draft.requirement} onChange={(event) => setDraft({ ...draft, requirement: event.target.value })} />
          <label className="attach-button">
            <Paperclip size={15} />上传凭证
            <input type="file" onChange={(event) => setDraft({ ...draft, evidence_path: event.target.files?.[0]?.path || "" })} />
          </label>
          {draft.evidence_path && <small>已选择：{draft.evidence_path.split(/[\\/]/).pop()}</small>}
          <div className="work-log-form-actions">
            <button type="submit"><Save size={16} />新增记录</button>
          </div>
        </form>
      </section>

      <section className="panel work-log-list-panel">
        <div className="panel-title">
          <div>
            <h2>工作留痕台账</h2>
            <span>点击一行查看详情；点击"修改"可直接在行内编辑</span>
          </div>
          <div className="work-log-filters">
            <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
              <option value="all">全部状态</option>
              {WORK_LOG_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
            </select>
            <select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
              <option value="all">全部标签</option>
              {allTags.map((tag) => <option key={tag}>{tag}</option>)}
            </select>
          </div>
        </div>
        <div className="work-log-table">
          <div className="work-log-head"><b>日期</b><b>事项</b><b>状态</b><b>标签</b><b>备注</b><b>操作</b></div>
          {filteredLogs.length === 0 && <div className="empty-row">暂无记录，先在左侧新增一条吧。</div>}
          {filteredLogs.map((log) => (
            editingId === log.id ? (
              <form className="work-log-row-edit" key={log.id} onSubmit={saveEdit}>
                <label className="dated-field"><span>日期</span><input type="date" value={editDraft.log_date} onChange={(event) => setEditDraft({ ...editDraft, log_date: event.target.value })} /></label>
                <label className="field-block"><span>事项</span><input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label>
                <label className="field-block"><span>状态</span>
                  <select value={editDraft.status} onChange={(event) => setEditDraft({ ...editDraft, status: event.target.value })}>
                    {WORK_LOG_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label className="field-block"><span>标签</span><input value={editDraft.tags} onChange={(event) => setEditDraft({ ...editDraft, tags: event.target.value })} list="work-log-tag-options" placeholder="用顿号分隔" /></label>
                <label className="field-block"><span>备注</span><input value={editDraft.remark} onChange={(event) => setEditDraft({ ...editDraft, remark: event.target.value })} /></label>
                <label className="field-block work-log-row-edit-wide"><span>要求</span><textarea value={editDraft.requirement} onChange={(event) => setEditDraft({ ...editDraft, requirement: event.target.value })} /></label>
                <label className="attach-button">
                  <Paperclip size={15} />{editDraft.evidence_file_id ? "更换凭证" : "上传凭证"}
                  <input type="file" onChange={(event) => setEditDraft({ ...editDraft, evidence_path: event.target.files?.[0]?.path || "" })} />
                </label>
                {editDraft.evidence_path && <small>已选择：{editDraft.evidence_path.split(/[\\/]/).pop()}</small>}
                <div className="work-log-row-actions work-log-row-edit-actions">
                  <button type="submit"><Save size={14} />保存</button>
                  <button type="button" className="subtle-button" onClick={cancelEdit}>取消</button>
                </div>
              </form>
            ) : (
              <div className="work-log-row-item" key={log.id} onClick={() => setDetailLog(log)}>
                <span>{log.log_date}</span>
                <b>{log.title}</b>
                <span className={`log-status-tag status-${workLogStatusKey(log.status)}`}>{log.status || "未开始"}</span>
                <span className="log-tag-list">
                  {splitTags(log.tags).length ? splitTags(log.tags).map((tag) => <em key={tag}>{tag}</em>) : <em className="is-empty">-</em>}
                </span>
                <span>{log.remark || "-"}</span>
                <div className="work-log-row-actions" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="subtle-button" onClick={(event) => startEdit(log, event)}>修改</button>
                  <button type="button" className="subtle-button" onClick={(event) => removeLog(log, event)}><Trash2 size={14} /></button>
                </div>
              </div>
            )
          ))}
        </div>
      </section>
      {detailLog && <WorkLogDetailModal log={detailLog} onClose={() => setDetailLog(null)} />}
    </section>
  );
}

function WorkLogDetailModal({ log, onClose }) {
  async function openEvidence() {
    if (!log.evidence_file_id) return;
    const result = await appApi.openFileExternal?.({ id: log.evidence_file_id });
    if (result && result.ok === false) window.alert(result.reason || "无法打开该凭证文件。");
  }
  return (
    <div className="modal-backdrop work-area-backdrop">
      <section className="detail-modal work-log-detail-modal">
        <div className="panel-title">
          <div>
            <h2>{log.title}</h2>
            <span>{log.log_date} · {log.type || "班级管理"}</span>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <div className="record-detail-grid">
          <span>状态</span><b className={`log-status-tag status-${workLogStatusKey(log.status)}`}>{log.status || "未开始"}</b>
          <span>标签</span><b>{splitTags(log.tags).join("、") || "-"}</b>
          <span>备注</span><b>{log.remark || "-"}</b>
          <span>凭证</span><b>{log.evidence_name || "无凭证"}</b>
        </div>
        <div className="detail-block">
          <b>要求</b>
          <span>{log.requirement || "暂无要求说明"}</span>
        </div>
        <div className="detail-block">
          <b>内容</b>
          <span>{log.content || "暂无内容"}</span>
        </div>
        {log.evidence_file_id && (
          <button type="button" className="small-primary-button" onClick={openEvidence}><Paperclip size={15} />打开凭证文件</button>
        )}
      </section>
    </div>
  );
}

function SystemSettingsPage({ data, draft, setDraft, onSave, onReload, onBackup, onShowSetupGuide }) {
  const folderItems = [
    ["roster", "学生名单"],
    ["homeVisit", "家校沟通"],
    ["resume", "学生简历"],
    ["schedule", "班级课程"],
    ["cooperation", "小组合作"],
    ["leave", "请假凭证"],
    ["exports", "默认导出文件夹"]
  ];
  return (
    <section className="settings-page">
      <section className="panel settings-panel">
        <div className="panel-title">
          <div>
            <h2>基本信息</h2>
            <span>这里修改后，会同步影响第几周、任教学科和课表统计</span>
          </div>
          {onShowSetupGuide && (
            <button type="button" className="soft-button" onClick={onShowSetupGuide}>查看首次启动引导</button>
          )}
        </div>
        <form className="settings-form" onSubmit={onSave}>
          <TeacherIdentityFields draft={draft} setDraft={setDraft} />
          <TeachingClassesField draft={draft} setDraft={setDraft} />
          <label>上下学期<select value={draft.termPart || "上学期"} onChange={(event) => setDraft({ ...draft, termPart: event.target.value })}><option>上学期</option><option>下学期</option></select></label>
          <label>任教学科<input value={draft.subject || ""} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label>开学日期<input type="date" value={draft.startDate || ""} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
          <button type="submit"><Save size={16} />保存设置</button>
        </form>
      </section>

      <section className="panel settings-panel">
        <div className="panel-title">
          <div>
            <h2>界面颜色</h2>
            <span>选择后立即预览效果，无需先保存</span>
          </div>
        </div>
        <select className="theme-picker" value={draft.theme || "blue"} onChange={(event) => setDraft({ ...draft, theme: event.target.value })}>
          <option value="blue">蓝白</option>
          <option value="green">护眼绿</option>
        </select>
      </section>

      <section className="panel settings-panel">
        <div className="panel-title">
          <div>
            <h2>项目数据文件夹</h2>
            <span>学生名单会导入并保存进本地数据库；其余几项只做路径映射、不复制文件，原件如果被移动、改名或删除，工作台里会读取不到。同一类资料散落在不同文件夹时都可以添加进来。</span>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={onReload}><RefreshCcw size={15} />一键更新数据</button>
            <button type="button" onClick={onBackup}><Download size={15} />备份数据库</button>
          </div>
        </div>
        <div className="folder-settings-list">
          {folderItems.map(([key, label]) => (
            <FolderMultiField
              key={key}
              label={label}
              values={normalizeFolderList((draft.dataFolders || {})[key])}
              onAdd={() => pickAndAddFolder(draft, setDraft, key)}
              onRemove={(index) => removeFolderAt(draft, setDraft, key, index)}
              onManualAdd={(value) => addManualFolder(draft, setDraft, key, value)}
            />
          ))}
        </div>
        <button type="button" className="small-primary-button" onClick={onSave}><Save size={15} />保存文件夹设置</button>
        <div className="settings-db-note">
          <Database size={18} />
          <span>当前 SQLite 数据库：{data.appInfo.dbPath}</span>
        </div>
      </section>
    </section>
  );
}

function LeavePage({ data, draft, setDraft, addLeaveRecord, updateLeaveRecord, deleteLeaveRecord }) {
  const [filters, setFilters] = useState({ className: "all", leaveType: "all", startDate: "2026-08-01", endDate: "2026-12-31" });
  const [editing, setEditing] = useState(null);
  const classes = data.appConfig?.teachingClasses?.length ? data.appConfig.teachingClasses : Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean)));
  const records = (data.leaveRecords || []).filter((record) => {
    if (filters.className !== "all" && record.class_name !== filters.className) return false;
    if (filters.leaveType !== "all" && record.leave_type !== filters.leaveType) return false;
    return record.leave_date >= filters.startDate && record.leave_date <= filters.endDate;
  });
  const target = editing || draft;
  const setTarget = editing ? setEditing : setDraft;

  async function exportRows() {
    const result = await appApi.exportLeaveRecords(filters);
    if (result?.canceled) window.alert("已取消导出。");
    else window.alert(result?.filePath ? `已导出：${result.filePath}` : "已完成导出。");
  }

  async function submit(event) {
    event.preventDefault();
    if (editing) {
      await updateLeaveRecord(editing);
      setEditing(null);
    } else {
      await addLeaveRecord(event);
    }
  }

  return (
    <section className="page-grid leave-page">
      <section className="panel leave-entry-panel">
        <div className="panel-title">
          <div>
            <h2>请假管理</h2>
            <span>家校沟通中的请假记录会自动同步到这里，也可手动新增</span>
          </div>
          <button type="button" className="small-primary-button" onClick={exportRows}><Download size={15} />导出</button>
        </div>
        <form className="leave-form" onSubmit={submit}>
          <label className="dated-field"><span>请假日期</span><input type="date" value={target.leave_date} onChange={(event) => setTarget({ ...target, leave_date: event.target.value })} /></label>
          <input
            list="leave-student-name-options"
            placeholder="直接输入学生姓名/学号"
            value={target.student_name || ""}
            onChange={(event) => {
              const value = event.target.value;
              const matched = data.students.find((student) => student.name === value || String(student.student_no) === value);
              setTarget({
                ...target,
                student_name: value,
                student_id: matched?.id || ""
              });
            }}
          />
          <datalist id="leave-student-name-options">
            {data.students.map((student) => <option value={student.name} key={student.id}>{student.class_name} · {student.student_no}</option>)}
          </datalist>
          <select value={target.student_id || ""} onChange={(event) => {
            const student = data.students.find((item) => String(item.id) === String(event.target.value));
            setTarget({ ...target, student_id: event.target.value, student_name: student?.name || target.student_name || "" });
          }}>
            <option value="">从名单选择</option>
            {data.students.map((student) => <option key={student.id} value={student.id}>{student.class_name} · {student.student_no}. {student.name}</option>)}
          </select>
          <select
            value={["全天", "上午", "下午"].includes(target.period_label) ? target.period_label : "自定义"}
            onChange={(event) => setTarget({ ...target, period_label: event.target.value === "自定义" ? "" : event.target.value })}
          ><option>全天</option><option>上午</option><option>下午</option><option>自定义</option></select>
          {!["全天", "上午", "下午"].includes(target.period_label) && (
            <input value={target.period_label} onChange={(event) => setTarget({ ...target, period_label: event.target.value })} placeholder="自定义时段，如 8:00-10:30" />
          )}
          <select value={target.leave_type} onChange={(event) => setTarget({ ...target, leave_type: event.target.value })}><option>病假</option><option>事假</option><option>其他</option></select>
          <input value={target.remark || ""} onChange={(event) => setTarget({ ...target, remark: event.target.value })} placeholder="备注" />
          <button type="submit"><Save size={16} />{editing ? "保存修改" : "新增请假"}</button>
          {editing && <button type="button" className="subtle-button" onClick={() => setEditing(null)}>取消</button>}
        </form>
        <div className="leave-filter-bar">
          <label>班级<select value={filters.className} onChange={(event) => setFilters({ ...filters, className: event.target.value })}><option value="all">全部</option>{classes.map((className) => <option key={className}>{className}</option>)}</select></label>
          <label>类型<select value={filters.leaveType} onChange={(event) => setFilters({ ...filters, leaveType: event.target.value })}><option value="all">全部</option><option>病假</option><option>事假</option><option>其他</option></select></label>
          <label>开始<input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></label>
          <label>结束<input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></label>
        </div>
      </section>

      <section className="panel leave-list-panel">
        <div className="leave-table">
          <div className="leave-head"><b>日期</b><b>班级</b><b>学生</b><b>时段</b><b>类型</b><b>备注</b><b>操作</b></div>
          {records.map((record) => (
            <div className="leave-row" key={record.id}>
              <span>{record.leave_date}</span>
              <span>{record.class_name}</span>
              <b>{record.student_no ? `${record.student_no}. ` : ""}{record.student_name}</b>
              <span>{record.period_label}</span>
              <span>{record.leave_type}</span>
              <span>{record.remark || "-"}</span>
              <div><button type="button" className="subtle-button" onClick={() => setEditing(record)}>修改</button><button type="button" className="subtle-button" onClick={() => deleteLeaveRecord(record)}>删除</button></div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function buildWeekOptions(data) {
  const total = Number(data.appConfig?.teachingWeeks || 20);
  const base = Array.from({ length: total }, (_, index) => `第${index + 1}周`);
  return Array.from(new Set([data.appConfig?.currentWeekLabel || "第1周", ...base, ...(data.changes || []).map((item) => item.week_label).filter(Boolean)]));
}

function ScheduleOverviewPage({ data, scheduleWeek, setScheduleWeek, changeDraft, setChangeDraft, setActivePage, setShowChangeModal }) {
  const [metricDetail, setMetricDetail] = useState(null);
  const weekOptions = buildWeekOptions(data);
  const weekChanges = data.changes.filter((item) => (item.week_label || data.appConfig.currentWeekLabel) === scheduleWeek);
  const classCourseCount = data.schedules.class.filter((cell) => cell.title).length;
  const personalCourseCount = data.schedules.personal.filter((cell) => cell.title).length;
  const electiveCount = data.electives?.courses?.length || 0;
  const stats = [
    ["班级课程", classCourseCount, CalendarDays, "本班基础课表"],
    ["任教课程", personalCourseCount, BookOpenCheck, `${data.appConfig.subject}课表`],
    ["自选课", electiveCount, Users, "探究课参与名单"],
    ["本周换课", weekChanges.length, RefreshCcw, scheduleWeek]
  ];
  const scheduleMetricDetails = {
    班级课程: data.schedules.class.filter((cell) => cell.title).map((cell) => ({
      title: `${days[cell.day_index] || ""} 第${periodLabels[cell.period_index] || ""}节 · ${cell.title}`,
      courseTitle: cell.title,
      dayIndex: Number(cell.day_index),
      periodIndex: Number(cell.period_index),
      timeLabel: periodTimeLabels[Number(cell.period_index)],
      meta: cell.class_name || data.scheduleMeta.className,
      note: cell.teacher ? `任课教师：${cell.teacher}` : "未填写任课教师"
    })),
    任教课程: data.schedules.personal.filter((cell) => cell.title).map((cell) => ({
      title: `${days[cell.day_index] || ""} 第${periodLabels[cell.period_index] || ""}节 · ${cell.title}`,
      courseTitle: cell.title,
      dayIndex: Number(cell.day_index),
      periodIndex: Number(cell.period_index),
      timeLabel: periodTimeLabels[Number(cell.period_index)],
      meta: cell.class_name || "任教班级未填",
      note: cell.teacher ? `任课教师：${cell.teacher}` : `${data.appConfig.subject}任教安排`
    })),
    自选课: (data.electives?.courses || []).map((course) => ({
      title: course.title || "待命名自选课",
      meta: [course.time_label, course.location].filter(Boolean).join(" · ") || "时间地点待填",
      note: `参与 ${data.electives?.enrollments?.filter((item) => String(item.course_id) === String(course.id)).length || 0} 人`
    })),
    本周换课: weekChanges.map((item) => ({
      title: `${item.change_date} · ${item.change_type || "换课"}`,
      meta: `${item.original_course || "原课程"} → ${item.new_course || "新课程"}`,
      note: `${item.scope === "both" ? "两张课表" : item.scope === "class" ? "班级课表" : "任教学科课表"} · ${item.reason || "暂无备注"}`
    }))
  };

  return (
    <section className="schedule-page">
      <div className="metric-row">
        {stats.map(([label, value, Icon, note]) => (
          <button className="metric-card" type="button" key={label} onClick={() => setMetricDetail(label)}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </button>
        ))}
      </div>
      <section className="panel schedule-overview-panel">
        <div className="panel-title">
          <div>
            <h2>课表管理看板</h2>
            <span>选择具体周次查看临时换课、代课、补课记录；对应周课表会同步黄底标注</span>
          </div>
          <div className="subject-actions">
            <select className="class-switcher" value={scheduleWeek} onChange={(event) => setScheduleWeek(event.target.value)}>
              {weekOptions.map((week) => <option key={week}>{week}</option>)}
            </select>
            <button type="button" className="small-primary-button" onClick={() => { setChangeDraft({ ...changeDraft, week_label: scheduleWeek }); setShowChangeModal(true); }}><Plus size={15} />新增换课</button>
          </div>
        </div>
        <div className="schedule-entry-grid">
          <button type="button" onClick={() => setActivePage("schedule-class")}><CalendarDays size={20} /><b>班级课程表</b><span>查看 {scheduleWeek} 班级课表与临时调整</span></button>
          <button type="button" onClick={() => setActivePage("schedule-personal")}><BookOpenCheck size={20} /><b>任教学科课程表</b><span>查看 {data.appConfig.subject} 任教安排</span></button>
          <button type="button" onClick={() => setActivePage("schedule-elective")}><Users size={20} /><b>自选课名单</b><span>探究课参与名单与总览</span></button>
        </div>
        <div className="change-list overview-change-list">
          {weekChanges.map((item) => (
            <div className="change-row" key={item.id}>
              <b>{item.week_label || data.appConfig.currentWeekLabel} · {item.change_date} · {item.change_type || "换课"}</b>
              <span>{item.original_course} → {item.new_course}</span>
              <small>{item.scope === "both" ? "两张课表" : item.scope === "class" ? "班级课表" : "任教学科课表"} · {item.day_index != null ? days[item.day_index] : "未选星期"} {item.period_index != null ? periodLabels[item.period_index] : ""}{item.target_day_index != null ? ` → ${days[item.target_day_index]} ${periodLabels[item.target_period_index] || ""}` : ""} · {item.reason || "暂无备注"}</small>
            </div>
          ))}
          {!weekChanges.length && <div className="empty-row">这一周暂无换课、代课或补课记录。</div>}
        </div>
      </section>
      {metricDetail && (
        <QuickDetailModal
          title={`${metricDetail}速览`}
          subtitle={metricDetail === "本周换课" ? scheduleWeek : "点击条目外区域可关闭"}
          items={scheduleMetricDetails[metricDetail]}
          onClose={() => setMetricDetail(null)}
        />
      )}
    </section>
  );
}

function SchedulePage({ data, mode, scheduleWeek, setScheduleWeek, selectedCell, setSelectedCell, saveCell, changeDraft, setChangeDraft, addChange, showChangeModal, setShowChangeModal, reload, applyScheduleSubjectColor }) {
  const [metricDetail, setMetricDetail] = useState(null);
  const teacherOptions = Array.from(new Set([...data.schedules.class, ...data.schedules.personal].map((cell) => cell.teacher).filter(Boolean))).sort();
  const isPersonal = mode === "personal";
  const weekOptions = buildWeekOptions(data);
  const currentScope = isPersonal ? "personal" : "class";
  const scopedChanges = data.changes.filter((item) => (item.scope === currentScope || item.scope === "both") && (item.week_label || data.appConfig.currentWeekLabel) === scheduleWeek);
  const classOptions = data.appConfig.teachingClasses?.length ? data.appConfig.teachingClasses : [];
  const defaultClassName = classOptions.includes(data.appConfig.grade) ? data.appConfig.grade : (classOptions[0] || "");
  const [selectedClassName, setSelectedClassName] = useState(defaultClassName);
  useEffect(() => {
    if (!classOptions.includes(selectedClassName)) setSelectedClassName(defaultClassName);
  }, [classOptions.join("|"), defaultClassName]);
  const classRows = data.schedules.class.filter((cell) => cell.class_name === selectedClassName);
  const stats = [
    ["本周总课时", data.scheduleStats.weeklyTotal, LayoutDashboard],
    ["今日课时", data.scheduleStats.todayCourses, CalendarDays],
    ["本周监考", data.scheduleStats.examDutyCount, School],
    ["调课记录", data.scheduleStats.changeCount, RefreshCcw]
  ];
  const todayIndex = (dateFromIso(todayIso()).getDay() + 6) % 7;
  const scheduleRowsForDetail = isPersonal ? data.schedules.personal : classRows;
  const scheduleMetricDetails = {
    本周总课时: scheduleRowsForDetail.filter((cell) => cell.title).map((cell) => ({
      title: `${days[cell.day_index] || ""} 第${periodLabels[cell.period_index] || ""}节 · ${cell.title}`,
      courseTitle: cell.title,
      dayIndex: Number(cell.day_index),
      periodIndex: Number(cell.period_index),
      timeLabel: periodTimeLabels[Number(cell.period_index)],
      meta: cell.class_name || selectedClassName || data.scheduleMeta.className,
      note: cell.teacher ? `任课教师：${cell.teacher}` : "教师待填"
    })),
    今日课时: scheduleRowsForDetail.filter((cell) => cell.title && cell.day_index === todayIndex).map((cell) => ({
      title: `第${periodLabels[cell.period_index] || ""}节 · ${cell.title}`,
      courseTitle: cell.title,
      dayIndex: Number(cell.day_index),
      periodIndex: Number(cell.period_index),
      timeLabel: periodTimeLabels[Number(cell.period_index)],
      meta: cell.class_name || selectedClassName || data.scheduleMeta.className,
      note: cell.teacher ? `任课教师：${cell.teacher}` : "教师待填"
    })),
    本周监考: (data.scheduleStats.examDuties || []).map((item) => ({
      title: item.title || item.course || "监考任务",
      meta: item.date || scheduleWeek,
      note: item.note || item.location || "暂无备注"
    })),
    调课记录: scopedChanges.map((item) => ({
      title: `${item.change_date} · ${item.change_type || "换课"}`,
      meta: `${item.original_course || "原课程"} → ${item.new_course || "新课程"}`,
      note: `${item.day_index != null ? days[item.day_index] : "未选星期"} ${item.period_index != null ? periodLabels[item.period_index] : ""} · ${item.reason || item.partner || "暂无备注"}`
    }))
  };

  return (
    <section className="schedule-page">
      <div className="metric-row">
        {stats.map(([label, value, Icon]) => (
          <button className="metric-card" type="button" key={label} onClick={() => setMetricDetail(label)}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value}</strong>
            {label === "调课记录" && <small>点击登记代课 / 换课 / 补课</small>}
          </button>
        ))}
      </div>

      <ScheduleTable
        title={isPersonal ? `${data.appConfig.subject}学科课表` : `班级课表${selectedClassName ? `（${selectedClassName}${selectedClassName === data.appConfig.grade ? " · 班主任班" : ""}）` : ""}`}
        subtitle={isPersonal ? `当前查看 ${scheduleWeek}；临时换课会黄底标注` : `当前查看 ${scheduleWeek}；临时换课会黄底标注`}
        scope={isPersonal ? "personal" : "class"}
        rows={isPersonal ? data.schedules.personal : classRows}
        changes={scopedChanges}
        scheduleWeek={scheduleWeek}
        setScheduleWeek={setScheduleWeek}
        weekOptions={weekOptions}
        setSelectedCell={setSelectedCell}
        saveCell={saveCell}
        reload={reload}
        teacherOptions={teacherOptions}
        subject={data.appConfig.subject}
        applyScheduleSubjectColor={applyScheduleSubjectColor}
        classOptions={isPersonal ? null : classOptions}
        selectedClassName={isPersonal ? "" : selectedClassName}
        onSelectClassName={setSelectedClassName}
      />

      <section className="panel changes-panel">
        <div className="panel-title">
          <h2>调课、补课登记管理</h2>
          <button type="button" className="small-primary-button" onClick={() => { setChangeDraft({ ...changeDraft, week_label: scheduleWeek }); setShowChangeModal(true); }}><Plus size={15} />新增调课记录</button>
        </div>
        <div className="change-list">
          {scopedChanges.map((item) => (
            <div className="change-row" key={item.id}>
              <b>{item.week_label || data.appConfig.currentWeekLabel} · {item.change_date} · {item.change_type || "换课"}</b>
              <span>{item.original_course} → {item.new_course}</span>
              <small>{item.scope === "both" ? "两张课表" : item.scope === "class" ? "班级课表" : "任教学科课表"} · {item.day_index != null ? days[item.day_index] : "未选星期"} {item.period_index != null ? periodLabels[item.period_index] : ""}{item.target_day_index != null ? ` → ${days[item.target_day_index]} ${periodLabels[item.target_period_index] || ""}` : ""} · {item.reason || item.partner || "暂无备注"}</small>
            </div>
          ))}
          {!scopedChanges.length && <div className="empty-row">{scheduleWeek} 暂无调课记录。</div>}
        </div>
      </section>

      {selectedCell && <CellEditor cell={selectedCell} onClose={() => setSelectedCell(null)} onSave={saveCell} teacherOptions={teacherOptions} />}
      {showChangeModal && (
        <ChangeEditor
          draft={changeDraft}
          setDraft={setChangeDraft}
          weekOptions={weekOptions}
          onClose={() => setShowChangeModal(false)}
          onSubmit={addChange}
        />
      )}
      {metricDetail && (
        <QuickDetailModal
          title={`${metricDetail}速览`}
          subtitle={scheduleWeek}
          items={scheduleMetricDetails[metricDetail]}
          onClose={() => setMetricDetail(null)}
        />
      )}
    </section>
  );
}

function ElectiveSchedulePage({ data, reload }) {
  const classes = data.appConfig?.teachingClasses?.length
    ? data.appConfig.teachingClasses
    : Array.from(new Set(data.students.map((student) => student.class_name).filter(Boolean)));
  const [className, setClassName] = useState(classes[0] || data.scheduleMeta?.className || "演示1班");
  useEffect(() => {
    if (!classes.includes(className)) setClassName(classes[0] || data.scheduleMeta?.className || "演示1班");
  }, [classes.join("|")]);
  const students = data.students.filter((student) => student.class_name === className);
  const courses = (data.electives?.courses || []).filter((course) => course.class_name === className);
  const enrollments = data.electives?.enrollments || [];
  const [courseFilter, setCourseFilter] = useState("all");
  useEffect(() => { setCourseFilter("all"); }, [className]);
  const displayCourses = Array.from({ length: 10 }, (_, index) => courses[index] || { id: "", class_name: className, course_name: `自选课${index + 1}`, course_time: "", location: "", isPlaceholder: true, slotIndex: index });
  const enrollmentSet = new Set(enrollments.map((item) => `${item.course_id}-${item.student_id}`));
  const selectedCourse = courses.find((course) => String(course.id) === String(courseFilter));
  const overviewCourses = selectedCourse ? [selectedCourse] : courses;

  // 注意：Electron 默认不支持 window.prompt（会直接返回 null，双击等于没反应），
  // 这里改成和花名册一样的“双击切换成输入框”方案，见下面的 ElectiveFieldCell。
  async function editCourseField(course, field, value) {
    try {
      if (course.isPlaceholder) {
        await appApi.addElectiveCourse({
          class_name: className,
          course_name: field === "course_name" ? (value || course.course_name) : course.course_name,
          course_time: field === "course_time" ? value : "",
          location: field === "location" ? value : ""
        });
      } else {
        await appApi.updateElectiveCourse({ ...course, [field]: value });
      }
      await reload();
    } catch (error) {
      window.alert(`保存失败：${error?.message || error}\n\n如果你刚更新过应用文件，请完全退出后重新打开一次桌面应用再试。`);
    }
  }

  async function toggleEnrollment(course, student) {
    if (course.isPlaceholder) {
      window.alert("请先双击课程名填写这门自选课，再添加学生。");
      return;
    }
    await appApi.toggleElectiveEnrollment({ course_id: course.id, student_id: student.id, class_name: className });
    await reload();
  }

  return (
    <section className="schedule-page elective-page">
      <section className="panel elective-panel">
        <div className="panel-title">
          <div>
            <h2>自选课名单</h2>
            <span>默认显示全班名单与 10 列待填自选课；课程名、时间、地点均可双击填写</span>
          </div>
          {classes.length > 1 && (
            <select className="class-switcher" value={className} onChange={(event) => setClassName(event.target.value)}>
              {classes.map((item) => <option key={item}>{item}</option>)}
            </select>
          )}
        </div>
        <div className="elective-layout">
          <div className="elective-table-wrap">
            <div className="elective-table" style={{ "--course-count": displayCourses.length }}>
              <div className="elective-head sticky-name">学生</div>
              {displayCourses.map((course, index) => (
                <div className={`elective-head course-head ${course.isPlaceholder ? "is-placeholder" : ""}`} key={course.id || `slot-${index}`}>
                  <ElectiveFieldCell
                    className="elective-course-name"
                    value={course.course_name}
                    editSeed={course.isPlaceholder ? "" : course.course_name}
                    placeholder="课程名称"
                    onCommit={(value) => editCourseField(course, "course_name", value)}
                  />
                  <ElectiveFieldCell
                    className="elective-course-meta"
                    value={course.course_time}
                    editSeed={course.course_time || ""}
                    placeholder="双击填时间"
                    onCommit={(value) => editCourseField(course, "course_time", value)}
                  />
                  <ElectiveFieldCell
                    className="elective-course-meta"
                    value={course.location}
                    editSeed={course.location || ""}
                    placeholder="双击填地点"
                    onCommit={(value) => editCourseField(course, "location", value)}
                  />
                </div>
              ))}
              {students.map((student) => (
                <React.Fragment key={student.id}>
                  <div className="elective-student sticky-name">{student.student_no}. {student.name}</div>
                  {displayCourses.map((course, index) => {
                    const joined = enrollmentSet.has(`${course.id}-${student.id}`);
                    return (
                      <button type="button" className={`elective-cell ${course.isPlaceholder ? "is-pending" : ""} ${joined ? "is-joined" : ""}`} key={`${course.id || `slot-${index}`}-${student.id}`} onDoubleClick={() => toggleEnrollment(course, student)}>
                        {joined ? "参加" : ""}
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          <aside className="elective-overview">
            <div className="panel-title">
              <div>
                <h2>兴趣课名单总览</h2>
                <span>筛选某一门课程查看参与名单</span>
              </div>
            </div>
            <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
              <option value="all">全部课程</option>
              {courses.map((course) => <option value={course.id} key={course.id}>{course.course_name}</option>)}
            </select>
            <div className="elective-overview-list">
              {overviewCourses.map((course) => {
                const joinedIds = new Set(enrollments.filter((item) => String(item.course_id) === String(course.id)).map((item) => String(item.student_id)));
                const joinedStudents = students.filter((student) => joinedIds.has(String(student.id)));
                return (
                  <article key={course.id}>
                    <b>{course.course_name}</b>
                    <span>{course.course_time || "未填时间"} · {course.location || "未填地点"} · {joinedStudents.length} 人</span>
                    <p>{joinedStudents.map((student) => student.name).join("、") || "暂无学生"}</p>
                  </article>
                );
              })}
            </div>
          </aside>
        </div>
      </section>
    </section>
  );
}

// 双击切换成输入框，失焦/回车保存，Esc 放弃修改；editSeed 是进入编辑态时输入框里的初始值
// （比如还没起名的占位课程，双击课程名时应该从空白开始填，而不是带着“自选课1”这几个字）
function ElectiveFieldCell({ className, value, editSeed, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editSeed);

  if (editing) {
    return (
      <input
        autoFocus
        className={`${className} elective-inline-input`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onBlur={async () => {
          setEditing(false);
          if (draft === editSeed) return;
          await onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(editSeed);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={className}
      onDoubleClick={() => {
        setDraft(editSeed);
        setEditing(true);
      }}
    >
      {value || placeholder}
    </button>
  );
}

function ChangeEditor({ draft, setDraft, weekOptions = [], onClose, onSubmit }) {
  const targetDayValue = draft.target_day_index === "" || draft.target_day_index == null ? draft.day_index : draft.target_day_index;
  const targetPeriodValue = draft.target_period_index === "" || draft.target_period_index == null ? draft.period_index : draft.target_period_index;
  return (
    <div className="modal-backdrop work-area-backdrop">
      <form className="cell-editor change-editor" onSubmit={onSubmit}>
        <div className="panel-title">
          <h2>新增调课记录</h2>
          <span>选择具体日期、星期与节次后，会在对应周课表中标注</span>
        </div>
        <div className="change-editor-grid">
          <label>周次<select value={draft.week_label || weekOptions[0] || "第1周"} onChange={(e) => setDraft({ ...draft, week_label: e.target.value })}>{weekOptions.map((week) => <option key={week}>{week}</option>)}</select></label>
          <label>日期<input value={draft.change_date} onChange={(e) => setDraft({ ...draft, change_date: e.target.value })} type="date" /></label>
          <label>类型<select value={draft.change_type} onChange={(e) => setDraft({ ...draft, change_type: e.target.value })}><option>换课</option><option>代课</option><option>补课</option></select></label>
          <label>课表<select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}><option value="both">两张课表同步</option><option value="class">班级课表</option><option value="personal">任教学科课表</option></select></label>
          <label>原星期<select value={draft.day_index} onChange={(e) => setDraft({ ...draft, day_index: e.target.value })}>{days.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
          <label>原节次<select value={draft.period_index} onChange={(e) => setDraft({ ...draft, period_index: e.target.value })}>{periodLabels.map((period, index) => <option value={index} key={period}>{period}</option>)}</select></label>
          <label>调整后星期<select value={targetDayValue} onChange={(e) => setDraft({ ...draft, target_day_index: e.target.value })}>{days.map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>
          <label>调整后节次<select value={targetPeriodValue} onChange={(e) => setDraft({ ...draft, target_period_index: e.target.value })}>{periodLabels.map((period, index) => <option value={index} key={period}>{period}</option>)}</select></label>
          <label>对接人<input placeholder="调课双方 / 代课老师" value={draft.partner} onChange={(e) => setDraft({ ...draft, partner: e.target.value })} /></label>
          <label className="wide-field">原课程 / 原安排<input value={draft.original_course} onChange={(e) => setDraft({ ...draft, original_course: e.target.value })} /></label>
          <label className="wide-field">调整后课程 / 补课安排<input value={draft.new_course} onChange={(e) => setDraft({ ...draft, new_course: e.target.value })} /></label>
          <label className="wide-field">原因 / 备注<textarea value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit"><Save size={16} />保存并标注课表</button>
        </div>
      </form>
    </div>
  );
}

function ScheduleTable({ title, subtitle, scope, rows, changes = [], scheduleWeek, setScheduleWeek, weekOptions = [], setSelectedCell, saveCell, reload, teacherOptions, subject, applyScheduleSubjectColor, classOptions, selectedClassName = "", onSelectClassName }) {
  // 教学课表里同一节课可能是"5班语文"、"6班语文"这种"班级前缀+学科"的写法，
  // "选择学科"下拉框只应该显示去掉班级前缀之后的纯学科名，避免同一学科重复出现两次。
  const classPrefixOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((cell) => {
      const match = (cell.title || "").match(/^(\d+班)/);
      if (match) set.add(match[1]);
    });
    return Array.from(set).sort();
  }, [rows]);
  const subjectOptions = useMemo(() => {
    const titles = rows.map((cell) => (cell.title || "").replace(/^\d+班/, "").trim()).filter(Boolean);
    return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [rows]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [selectedClassPrefixes, setSelectedClassPrefixes] = useState(classPrefixOptions);
  const [markingItem, setMarkingItem] = useState(null);
  const pickerRef = useRef(null);
  const classPickerRef = useRef(null);
  useClickOutside(pickerRef, () => setPickerOpen(false), pickerOpen);
  useClickOutside(classPickerRef, () => setClassPickerOpen(false), classPickerOpen);
  useEffect(() => {
    setSelectedClassPrefixes(classPrefixOptions);
  }, [classPrefixOptions.join("|")]);
  const cellMap = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => map.set(`${row.day_index}-${row.period_index}`, row));
    return map;
  }, [rows]);

  const timeLabels = Array.from({ length: periodCount }, (_, period) => {
    const found = rows.find((row) => row.period_index === period);
    return found?.time_label || `第 ${period + 1} 节`;
  });

  const classFilterActive = classPrefixOptions.length > 0 && selectedClassPrefixes.length > 0 && selectedClassPrefixes.length < classPrefixOptions.length;

  function isSubjectMarked(item) {
    const relevantRows = classFilterActive
      ? rows.filter((cell) => {
          const match = (cell.title || "").match(/^(\d+班)/);
          return match ? selectedClassPrefixes.includes(match[1]) : false;
        })
      : rows;
    const cells = relevantRows.filter((cell) => (cell.title || "").replace(/^\d+班/, "").trim() === item);
    return cells.length > 0 && cells.every((cell) => isSubjectMarkColor(cell.bg_color));
  }

  const markedSubjects = subjectOptions.filter(isSubjectMarked);

  async function toggleSubjectMark(item, checked) {
    setMarkingItem(item);
    try {
      const subjects = classFilterActive ? selectedClassPrefixes.map((prefix) => `${prefix}${item}`) : [item];
      await applyScheduleSubjectColor({ scope, class_name: selectedClassName, subjects, bg_color: checked ? teachingSubjectMarkColor : "" });
    } finally {
      setMarkingItem(null);
    }
  }

  return (
    <section className="panel table-panel">
      <div className="panel-title">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
        <div className="table-actions">
          {classOptions && classOptions.length > 1 && (
            <select className="class-switcher" value={selectedClassName} onChange={(event) => onSelectClassName(event.target.value)}>
              {classOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          <select className="class-switcher" value={scheduleWeek} onChange={(event) => setScheduleWeek(event.target.value)}>
            {weekOptions.map((week) => <option key={week}>{week}</option>)}
          </select>
          <div className={`subject-mark-picker ${markedSubjects.length ? "is-marked" : ""}`} ref={pickerRef}>
            <button type="button" className="subject-mark-summary" onClick={() => setPickerOpen((value) => !value)}>
              {markedSubjects.length ? markedSubjects.join("、") : "选择学科"}
            </button>
            {pickerOpen && (
              <div className="subject-mark-options">
                {subjectOptions.map((item) => {
                  const marked = isSubjectMarked(item);
                  return (
                    <label className={marked ? "is-checked" : ""} key={item}>
                      <input
                        type="checkbox"
                        checked={marked}
                        disabled={markingItem === item}
                        onChange={(event) => toggleSubjectMark(item, event.target.checked)}
                      />
                      {item}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {classPrefixOptions.length > 0 && (
            <div className={`subject-mark-picker ${classFilterActive ? "is-marked" : ""}`} ref={classPickerRef}>
              <button type="button" className="subject-mark-summary" onClick={() => setClassPickerOpen((value) => !value)}>
                {classFilterActive ? selectedClassPrefixes.join("、") : "选择班级"}
              </button>
              {classPickerOpen && (
                <div className="subject-mark-options">
                  {classPrefixOptions.map((prefix) => {
                    const checked = selectedClassPrefixes.includes(prefix);
                    return (
                      <label className={checked ? "is-checked" : ""} key={prefix}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedClassPrefixes((current) =>
                              event.target.checked ? Array.from(new Set([...current, prefix])) : current.filter((item) => item !== prefix)
                            );
                          }}
                        />
                        {prefix}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <label>
            <Upload size={15} />
            上传课表
            <input
              type="file"
              accept=".xlsx,.xls,.csv,image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file?.path) {
                  await appApi.importScheduleScreenshot({ path: file.path, scope, class_name: selectedClassName });
                  await reload();
                  const name = file.name || file.path;
                  window.alert(/\.(xlsx|xls|csv)$/i.test(name) ? "已识别并导入课表。" : "已上传课表图片。图片已存档，若需自动识别图片内容，后续可接入 OCR。");
                }
                event.target.value = "";
              }}
            />
          </label>
          <button type="button"><ImageDown size={15} />导出图片</button>
        </div>
      </div>

      <div className="schedule-table">
        <div className="table-head time-head">时间</div>
        <div className="table-head period-head">节次</div>
        {days.map((day) => <div className="table-head" key={day}>{day}</div>)}
        {Array.from({ length: periodCount }, (_, period) => (
          <React.Fragment key={period}>
            <button
              className={`time-cell ${[0, 5, 10].includes(period) ? "watch-row" : ""}`}
              type="button"
              onClick={() => setSelectedCell(cellMap.get(`0-${period}`) || blankCell(scope, 0, period, selectedClassName))}
            >
              {timeLabels[period]}
            </button>
            <div className={`period-cell ${[0, 5, 10].includes(period) ? "watch-row" : ""}`}>{periodLabels[period]}</div>
            {days.map((day, dayIndex) => {
              const cell = cellMap.get(`${dayIndex}-${period}`) || blankCell(scope, dayIndex, period, selectedClassName);
              const weeklyChanges = changes.filter((item) => {
                const primary = String(item.day_index) === String(dayIndex) && String(item.period_index) === String(period);
                const target = item.target_day_index != null && String(item.target_day_index) === String(dayIndex) && String(item.target_period_index) === String(period);
                return primary || target;
              });
              return (
                <CourseCell cell={cell} weeklyChanges={weeklyChanges} key={day} setSelectedCell={setSelectedCell} saveCell={saveCell} teacherOptions={teacherOptions} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function CourseCell({ cell, weeklyChanges = [], setSelectedCell, saveCell }) {
  const [title, setTitle] = useState(cell.title || "");
  const [teacher, setTeacher] = useState(["任课教师", "任课老师"].includes(cell.teacher) ? "" : cell.teacher || "");

  useEffect(() => {
    setTitle(cell.title || "");
    setTeacher(["任课教师", "任课老师"].includes(cell.teacher) ? "" : cell.teacher || "");
  }, [cell.id, cell.title, cell.teacher]);

  function commit() {
    const cleanTeacher = ["任课教师", "任课老师"].includes(teacher.trim()) ? "" : teacher.trim();
    if ((cell.title || "") === title && (cell.teacher || "") === cleanTeacher) return;
    saveCell({ ...cell, title, teacher: cleanTeacher });
  }

  return (
    <div className={`course-cell ${cell.tag ? "has-tag" : ""} ${cell.bg_color ? "has-subject-mark" : ""} ${weeklyChanges.length ? "has-week-change" : ""} ${[0, 5, 10].includes(Number(cell.period_index)) ? "watch-row" : ""}`} style={cell.bg_color && !weeklyChanges.length ? { background: displaySubjectMarkColor(cell.bg_color) } : undefined} role="button" tabIndex={0} onClick={() => setSelectedCell(cell)}>
      <input
        value={title}
        placeholder="直接录入"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <input
        className="teacher-inline-input"
        value={teacher}
        placeholder="老师姓名"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setTeacher(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {cell.tag && <em>{cell.tag}</em>}
      {weeklyChanges.map((item) => (
        <em className="week-change-note" key={item.id}>{item.change_type || "换课"}：{item.original_course}→{item.new_course}{item.reason ? `；${item.reason}` : ""}</em>
      ))}
    </div>
  );
}

function CellEditor({ cell, onClose, onSave, teacherOptions }) {
  const [draft, setDraft] = useState(cell);

  return (
    <div className="modal-backdrop work-area-backdrop">
      <form className="cell-editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
        <div className="panel-title">
          <h2>修改课表单元格</h2>
          <span>{draft.scope === "class" ? "班级课表" : "学科课表"} · {days[draft.day_index]} · {periodLabels[draft.period_index]}</span>
        </div>
        <label>时间<input value={draft.time_label} onChange={(e) => setDraft({ ...draft, time_label: e.target.value })} /></label>
        <label>课程/任务<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>老师姓名<input list="teacher-options" placeholder="输入老师姓名" value={["任课教师", "任课老师"].includes(draft.teacher) ? "" : draft.teacher} onChange={(e) => setDraft({ ...draft, teacher: e.target.value })} /></label>
        <datalist id="teacher-options">
          {teacherOptions.map((teacher) => <option value={teacher} key={teacher} />)}
        </datalist>
        <label>标记<input placeholder="实验课 / 班会 / 活动 / 监考" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} /></label>
        <label>备注<textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit"><Save size={16} />保存并更新课表</button>
        </div>
      </form>
    </div>
  );
}

function ComingSoon({ page }) {
  return (
    <section className="panel coming-soon">
      <GraduationCap size={38} />
      <h2>{page}正在接入本地数据库</h2>
      <p>架构已经预留 Excel 导入导出、Word 导出、图片导出、备份恢复和学生信息共享。下一步可以逐个模块补齐表单与数据表。</p>
    </section>
  );
}

function createPreviewWorkbench() {
  const storageKey = "class-teacher-workbench-preview";

  function initialData() {
    const timeLabels = ["7:30-8:00", "8:25-9:05", "9:15-9:55", "10:05-10:50", "11:00-11:40", "12:20-12:50", "12:55-13:40", "13:50-14:35", "15:05-15:45", "15:55-16:35", "16:45-17:20"];
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
      ["演示2班语文", "演示2班语文", "演示2班语文", "演示2班语文", "演示2班语文"],
      ["", "", "演示1班语文", "演示2班语文", ""],
      ["演示1班语文", "", "", "演示2班语文", ""],
      ["演示1班语文", "", "", "演示1班语文", "演示2班语文"],
      ["", "", "", "", ""],
      ["", "演示1班语文", "", "", "演示2班语文"],
      ["", "", "", "", "演示1班语文"],
      ["", "", "", "", "少先队活动课"],
      ["演示2班语文", "演示2班语文", "", "", "演示2班语文"],
      ["", "演示1班语文", "演示2班语文", "", ""],
      ["", "演示2班语文", "", "", ""]
    ];

    const buildCells = (scope, grid) => {
      const cells = [];
      for (let period = 0; period < periodCount; period += 1) {
        for (let day = 0; day < days.length; day += 1) {
          cells.push({
            id: cells.length + 1,
            scope,
            class_name: scope === "class" ? "演示1班" : "",
            day_index: day,
            period_index: period,
            time_label: timeLabels[period],
            title: grid[period][day],
            teacher: "",
            location: grid[period][day] ? "教室" : "",
            tag: grid[period][day]?.includes("语文") ? "授课" : "",
            note: ""
          });
        }
      }
      return cells;
    };

    const students = [
      ...["云知夏", "沈星禾", "苏念晴", "许清越", "乔安澄", "林听雨", "陆明川", "程远舟"].map((name, index) => ({
        id: index + 1,
        student_no: String(index + 1),
        name,
        gender: index < 8 ? "女" : "",
        class_name: "演示1班",
        guardian: "家长",
        guardian_relation: "监护人",
        guardian_phone: "13800000000",
        elementary_school: "星河小学",
        roles: "",
        student_remark: "",
        seating_remark: "",
        is_observed: 0,
        honors: "",
        subject_profile: ""
      })),
      ...["顾青岚", "叶安澄", "江予白", "夏听澜", "温言蹊", "唐若宁", "秦望舒", "何景行"].map((name, index) => ({
        id: index + 101,
        student_no: String(index + 1),
        name,
        gender: "",
        class_name: "演示2班",
        guardian: "家长",
        guardian_relation: "监护人",
        guardian_phone: "13800000000",
        elementary_school: "云杉小学",
        roles: "",
        student_remark: "",
        seating_remark: "",
        is_observed: 0,
        honors: "",
        subject_profile: ""
      }))
    ];
    const previewGroups = ["演示1班", "演示2班"].flatMap((className) =>
      Array.from({ length: 4 }, (_, index) => ({
        id: `${className}-${index + 1}`,
        class_name: className,
        name: `第${index + 1}小组`,
        color: ["#1f67b1", "#4fa66a", "#d99b33", "#d96058"][index],
        goal: "合作学习、互助成长",
        points: index === 0 ? 6 : index === 1 ? 3 : 0,
        achievement_count: index === 0 ? 2 : 0,
        reminder_count: index === 1 ? 1 : 0
      }))
    );
    const previewMembers = students.map((student, index) => {
      const classGroups = previewGroups.filter((group) => group.class_name === student.class_name);
      const group = classGroups[index % classGroups.length];
      return {
        id: `${group.id}-${student.id}`,
        group_id: group.id,
        student_id: student.id,
        name: student.name,
        student_no: student.student_no,
        class_name: student.class_name,
        role: "",
        points: index % 5 === 0 ? 2 : 0,
        achievement_count: index % 5 === 0 ? 1 : 0,
        reminder_count: 0
      };
    });

    return hydratePreview({
      appInfo: {
        dbPath: "桌面应用中保存到 data/classroom-workbench.sqlite",
        dataDir: "浏览器演示模式",
        attachmentsDir: "浏览器演示模式",
        exportsDir: "浏览器演示模式"
      },
      appConfig: {
        configured: false,
        grade: "演示1班",
        termPart: "上学期",
        subject: "语文",
        teachingWeeks: 20,
        startDate: "2026-09-01",
        teacherName: "",
        teacherPhone: "",
        theme: "blue",
        dataMode: "demo",
        dataFolders: {},
        currentWeekLabel: "第1周",
        teachingClasses: ["演示1班", "演示2班"]
      },
      scheduleMeta: {
        className: "演示1班",
        term: "2026 学年上学期",
        weekLabel: "第1周"
      },
      rosterImportInfo: { file: "浏览器演示数据", count: students.length },
      students,
      schedules: {
        class: buildCells("class", classCourses),
        personal: buildCells("personal", subjectCourses)
      },
      electives: {
        courses: [
          { id: 1, class_name: "演示1班", course_name: "科学探究", course_time: "周三 15:05-15:45", location: "实验室", note: "" },
          { id: 2, class_name: "演示1班", course_name: "文学社", course_time: "周五 15:05-15:45", location: "阅览室", note: "" }
        ],
        enrollments: []
      },
      changes: [],
      files: [],
      studentResumes: students.map((student) => ({
        id: student.id,
        kind: "student-resume",
        original_name: `${student.name} 学生简历.jpg`,
        saved_path: ""
      })),
      logs: [
        { id: 1, log_date: "2026-08-19", type: "班级管理", title: "浏览器演示模式", content: "正式数据请在桌面应用中保存" }
      ],
      classTodos: [],
      familyCommunications: [
        { id: 1, communication_date: "2026-08-01", student_name: "云知夏", contact_person: "家长", channel: "家访", category: "家访", title: "新生家访归档", content: "浏览器演示记录", status: "已完成", deadline_date: "" },
        { id: 2, communication_date: "2026-08-22", student_name: "沈星禾", contact_person: "妈妈", channel: "微信", category: "学习反馈", title: "阅读作业需跟进", content: "需要提醒订正阅读题格式。", status: "待跟进", deadline_date: "" }
      ],
      familyCommittee: [
        { id: 1, class_name: "演示1班", student_name: "云知夏", relation: "妈妈", parent_name: "", role: "家委会联络", phone: "", note: "" }
      ],
      familyActivities: [
        { id: 1, class_name: "演示1班", activity_date: "2026-09-05", title: "新学期家长志愿活动", activity_type: "班级活动", description: "协助开学材料整理", parent_division: "云知夏妈妈：物资统筹", status: "筹备中" }
      ],
      leaveRecords: [],
      seating: [],
      cooperation: {
        groups: previewGroups,
        members: previewMembers,
        projects: [],
        records: [
          { id: 1, record_date: "2026-08-24", class_name: "演示1班", group_id: "演示1班-1", group_name: "第1小组", student_id: 1, student_name: "云知夏", type: "achievement", category: "课堂合作", points: 2, title: "小组讨论主动组织", note: "能带同伴完成观点整理" },
          { id: 2, record_date: "2026-08-24", class_name: "演示2班", group_id: "演示2班-2", group_name: "第2小组", student_id: 102, student_name: "叶安澄", type: "reminder", category: "作业拖欠", points: -1, title: "订正未按时完成", note: "已提醒下次补交" }
        ],
        stats: { groupCount: previewGroups.length, recordCount: 2, achievementCount: 1, reminderCount: 1 }
      },
      subject: {
        plans: [
          { id: 1, week_label: "第1周", plan_date: "2026-08-20", subject: "语文", class_name: "", lesson_type: "新授课", lesson_title: "初中语文学习方法与课堂规范", lesson_goal: "建立语文课堂规范", resources: "导学单", is_done: 1 },
          { id: 2, week_label: "第1周", plan_date: "2026-08-21", subject: "语文", class_name: "", lesson_type: "新授课", lesson_title: "现代文阅读：概括与信息提取", lesson_goal: "圈画关键信息并完成概括", resources: "阅读练习", is_done: 0 }
        ],
        homework: [
          { id: 1, title: "语文导学单：初中语文学习准备", subject: "语文", class_name: "", homework_type: "日常作业", assign_date: "2026-08-20", due_date: "2026-08-21", assigned_count: 16, submitted_count: 12, checked_count: 8, issue_count: 1, note: "圈画不充分 1 人", status: "进行中", is_done: 0 },
          { id: 2, title: "阅读练习：信息提取与概括", subject: "语文", class_name: "演示2班", homework_type: "周期作业", assign_date: "2026-08-22", due_date: "2026-08-25", assigned_count: 8, submitted_count: 5, checked_count: 3, issue_count: 2, note: "概括表达需跟进", status: "未收齐", is_done: 0 }
        ],
        recitations: [
          { id: 1, title: "《春》重点段落", subject: "语文", class_name: "", recitation_type: "背诵", assign_date: "2026-08-20", due_date: "2026-08-23", content: "第2-4段", note: "", status: "进行中", is_done: 0 }
        ],
        assessments: [
          { id: 1, title: "入学语文基础测评", subject: "语文", class_name: "", test_type: "阶段测试", test_date: "2026-08-26", excellent_score: 90, pass_score: 60, paper_path: "", note: "演示测评" }
        ],
        assessmentScores: [],
        taskStatuses: []
      }
    });
  }

  function load() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return initialData();
    try {
      return hydratePreview(JSON.parse(saved));
    } catch {
      return initialData();
    }
  }

  function save(data) {
    const next = hydratePreview(data);
    localStorage.setItem(storageKey, JSON.stringify(next));
    return next;
  }

  return {
    getBootstrapData: async () => load(),
    chooseFolder: async () => {
      window.alert("文件夹选择请在桌面应用中使用；浏览器预览可以手动粘贴路径。");
      return [];
    },
    updateDataFromFolders: async () => {
      const data = load();
      window.alert("浏览器预览不会读取本地文件夹；请在桌面应用中使用一键更新数据。");
      return save(data);
    },
    ackSetupReview: async () => {
      const data = load();
      data.appConfig = { ...data.appConfig, setupReviewPending: false };
      return save(data);
    },
    saveAppConfig: async (payload) => {
      const data = load();
      data.appConfig = {
        ...data.appConfig,
        ...payload,
        configured: true,
        dataMode: payload.dataFolders?.roster ? "local" : "demo",
        teachingClasses: payload.dataFolders?.roster ? ["预备5班", "预备6班"] : ["演示1班", "演示2班"],
        currentWeekLabel: "第1周",
        setupReviewPending: false
      };
      data.scheduleMeta = { ...data.scheduleMeta, className: payload.grade, term: `2026 学年${payload.termPart}`, weekLabel: "第1周" };
      return save(data);
    },
    saveScheduleCell: async (payload) => {
      const data = load();
      const className = payload.scope === "class" ? (payload.class_name || "") : "";
      const list = data.schedules[payload.scope];
      const index = list.findIndex((cell) => cell.day_index === payload.day_index && cell.period_index === payload.period_index && (cell.class_name || "") === className);
      const previous = index >= 0 ? list[index] : null;
      if (index >= 0) list[index] = { ...list[index], ...payload, class_name: className };
      else list.push({ ...payload, class_name: className, id: Date.now() });
      list.forEach((cell) => {
        if (cell.period_index === payload.period_index && (cell.class_name || "") === className) cell.time_label = payload.time_label || cell.time_label;
      });
      const teacher = (payload.teacher || "").trim();
      const subjectTitle = payload.title || previous?.title || "";
      if (teacher && subjectTitle) {
        list.forEach((cell) => {
          if (cell.title === subjectTitle && (cell.class_name || "") === className) cell.teacher = teacher;
        });
      }
      return save(data);
    },
    applyScheduleSubjectColor: async (payload) => {
      const data = load();
      const subjects = Array.isArray(payload.subjects) && payload.subjects.length ? payload.subjects : [payload.subject || data.appConfig.subject || "语文"];
      for (const scope of ["class", "personal"]) {
        if (payload.scope && payload.scope !== scope) continue;
        data.schedules[scope] = data.schedules[scope].map((cell) => {
          if (scope === "class" && (cell.class_name || "") !== (payload.class_name || "")) return cell;
          const title = cell.title || "";
          return subjects.some((subject) => title === subject || title.includes(subject))
            ? { ...cell, bg_color: Object.prototype.hasOwnProperty.call(payload, "bg_color") ? payload.bg_color : teachingSubjectMarkColor }
            : cell;
        });
      }
      return save(data);
    },
    addScheduleChange: async (payload) => {
      const data = load();
      data.changes.unshift({ ...payload, id: Date.now(), week_label: payload.week_label || data.appConfig.currentWeekLabel });
      return save(data);
    },
    importScheduleScreenshot: async () => load(),
    addElectiveCourse: async (payload) => {
      const data = load();
      data.electives = data.electives || { courses: [], enrollments: [] };
      data.electives.courses.push({ ...payload, id: Date.now(), course_name: payload.course_name || "新探究课", course_time: payload.course_time || "", location: payload.location || "", note: "" });
      return save(data);
    },
    updateElectiveCourse: async (payload) => {
      const data = load();
      data.electives = data.electives || { courses: [], enrollments: [] };
      data.electives.courses = (data.electives.courses || []).map((course) => String(course.id) === String(payload.id) ? { ...course, ...payload } : course);
      return save(data);
    },
    toggleElectiveEnrollment: async (payload) => {
      const data = load();
      data.electives = data.electives || { courses: [], enrollments: [] };
      const exists = (data.electives.enrollments || []).some((item) => String(item.course_id) === String(payload.course_id) && String(item.student_id) === String(payload.student_id));
      data.electives.enrollments = exists
        ? data.electives.enrollments.filter((item) => !(String(item.course_id) === String(payload.course_id) && String(item.student_id) === String(payload.student_id)))
        : [...(data.electives.enrollments || []), { ...payload, id: Date.now() }];
      return save(data);
    },
    addSubjectPlan: async (payload) => {
      const data = load();
      data.subject.plans.push({ ...payload, id: Date.now(), week_label: data.appConfig.currentWeekLabel, is_done: 0 });
      return save(data);
    },
    updateSubjectPlan: async (payload) => {
      const data = load();
      data.subject.plans = data.subject.plans.map((plan) => plan.id === payload.id ? { ...plan, ...payload } : plan);
      return save(data);
    },
    deleteSubjectPlan: async (payload) => {
      const data = load();
      data.subject.plans = data.subject.plans.filter((plan) => plan.id !== payload.id);
      return save(data);
    },
    toggleSubjectPlan: async (payload) => {
      const data = load();
      data.subject.plans = data.subject.plans.map((plan) => plan.id === payload.id ? { ...plan, is_done: payload.is_done ? 1 : 0 } : plan);
      return save(data);
    },
    addHomeworkTask: async (payload) => {
      const data = load();
      data.subject.homework.push({ ...payload, id: Date.now(), homework_type: payload.homework_type || "日常作业", submitted_count: 0, checked_count: 0, issue_count: 0, status: "进行中", is_done: 0 });
      return save(data);
    },
    updateHomeworkTask: async (payload) => {
      const data = load();
      data.subject.homework = data.subject.homework.map((task) => task.id === payload.id ? { ...task, ...payload } : task);
      return save(data);
    },
    deleteHomeworkTask: async (payload) => {
      const data = load();
      data.subject.homework = data.subject.homework.filter((task) => task.id !== payload.id);
      data.subject.taskStatuses = (data.subject.taskStatuses || []).filter((status) => !(status.task_kind === "homework" && status.task_id === payload.id));
      return save(data);
    },
    addRecitationTask: async (payload) => {
      const data = load();
      data.subject.recitations = data.subject.recitations || [];
      data.subject.recitations.push({ ...payload, id: Date.now(), recitation_type: payload.recitation_type || "背诵", status: "进行中", is_done: 0 });
      return save(data);
    },
    updateRecitationTask: async (payload) => {
      const data = load();
      data.subject.recitations = (data.subject.recitations || []).map((task) => task.id === payload.id ? { ...task, ...payload } : task);
      return save(data);
    },
    deleteRecitationTask: async (payload) => {
      const data = load();
      data.subject.recitations = (data.subject.recitations || []).filter((task) => task.id !== payload.id);
      data.subject.taskStatuses = (data.subject.taskStatuses || []).filter((status) => !(status.task_kind === "recitation" && status.task_id === payload.id));
      return save(data);
    },
    addAssessment: async (payload) => {
      const data = load();
      data.subject.assessments = data.subject.assessments || [];
      data.subject.assessments.unshift({ ...payload, id: Date.now(), test_type: payload.test_type || "单元测评", excellent_score: Number(payload.excellent_score || 90), pass_score: Number(payload.pass_score || 60), score_columns: Array.isArray(payload.score_columns) ? payload.score_columns : [] });
      return save(data);
    },
    updateAssessment: async (payload) => {
      const data = load();
      data.subject.assessments = (data.subject.assessments || []).map((test) => String(test.id) === String(payload.id) ? { ...test, ...payload } : test);
      return save(data);
    },
    deleteAssessment: async (payload) => {
      const data = load();
      data.subject.assessments = (data.subject.assessments || []).filter((test) => String(test.id) !== String(payload.id));
      data.subject.assessmentScores = (data.subject.assessmentScores || []).filter((score) => String(score.test_id) !== String(payload.id));
      return save(data);
    },
    setAssessmentScore: async (payload) => {
      const data = load();
      data.subject.assessmentScores = data.subject.assessmentScores || [];
      const index = data.subject.assessmentScores.findIndex((score) => String(score.test_id) === String(payload.test_id) && String(score.student_id) === String(payload.student_id) && score.class_name === payload.class_name);
      if (index >= 0) data.subject.assessmentScores[index] = { ...data.subject.assessmentScores[index], ...payload };
      else data.subject.assessmentScores.push({ breakdown: {}, ...payload, id: Date.now() });
      return save(data);
    },
    setTaskStudentStatus: async (payload) => {
      const data = load();
      data.subject.taskStatuses = data.subject.taskStatuses || [];
      const index = data.subject.taskStatuses.findIndex((status) => status.task_kind === payload.task_kind && status.task_id === payload.task_id && status.student_id === payload.student_id);
      if (index >= 0) data.subject.taskStatuses[index] = { ...data.subject.taskStatuses[index], ...payload };
      else data.subject.taskStatuses.push({ ...payload, id: Date.now() });
      return save(data);
    },
    addFamilyCommunication: async (payload) => {
      const data = load();
      const category = Array.isArray(payload.category) ? payload.category.join("、") : payload.category || "";
      const record = { ...payload, category, id: Date.now(), original_name: payload.attachment_path ? "浏览器演示附件" : "" };
      data.familyCommunications.unshift(record);
      if (category.includes("请假") || payload.is_leave) {
        const student = data.students.find((item) => String(item.id) === String(payload.student_id));
        data.leaveRecords = data.leaveRecords || [];
        data.leaveRecords.unshift({ id: Date.now() + 1, leave_date: payload.communication_date, student_id: student?.id, student_no: student?.student_no, student_name: student?.name || payload.student_name || "", class_name: student?.class_name || "", period_label: payload.leave_period || "全天", leave_type: payload.leave_type || "病假", remark: payload.leave_remark || payload.content || "" });
      }
      return save(data);
    },
    updateFamilyCommunication: async (payload) => {
      const data = load();
      data.familyCommunications = (data.familyCommunications || []).map((record) => String(record.id) === String(payload.id) ? { ...record, ...payload } : record);
      return save(data);
    },
    deleteFamilyCommunication: async (payload) => {
      const data = load();
      data.familyCommunications = (data.familyCommunications || []).filter((record) => String(record.id) !== String(payload.id));
      return save(data);
    },
    addFamilyCommittee: async (payload) => {
      const data = load();
      data.familyCommittee = data.familyCommittee || [];
      data.familyCommittee.push({ ...payload, id: Date.now() });
      return save(data);
    },
    updateFamilyCommittee: async (payload) => {
      const data = load();
      data.familyCommittee = (data.familyCommittee || []).map((row) => String(row.id) === String(payload.id) ? { ...row, ...payload } : row);
      return save(data);
    },
    addFamilyActivity: async (payload) => {
      const data = load();
      data.familyActivities = data.familyActivities || [];
      data.familyActivities.unshift({ ...payload, id: Date.now(), activity_file_name: payload.activity_file_name || (payload.attachment_path ? "浏览器演示活动文件" : "") });
      return save(data);
    },
    updateFamilyActivity: async (payload) => {
      const data = load();
      data.familyActivities = (data.familyActivities || []).map((row) => String(row.id) === String(payload.id) ? { ...row, ...payload } : row);
      return save(data);
    },
    addClassTodo: async (payload) => {
      const data = load();
      const selectedStudents = data.students.filter((item) => (payload.student_ids || []).map(String).includes(String(item.id)));
      const todo = { ...payload, id: Date.now(), student_name: selectedStudents.map((student) => student.name).join("、"), credential_name: payload.credential_path ? "浏览器演示凭证" : "" };
      data.classTodos = [todo, ...(data.classTodos || [])].slice(0, 500);
      if (payload.sync_work_log !== false) {
        data.logs = [{ id: Date.now() + 1, log_date: payload.todo_date, type: payload.area === "其他" ? "其他事务" : "班级待办", title: payload.title, content: [payload.requirement, payload.detail].filter(Boolean).join("；") }, ...(data.logs || [])].slice(0, 15);
      }
      if (payload.sync_family && selectedStudents.length) {
        for (const student of selectedStudents) {
          data.familyCommunications.unshift({ id: Date.now() + Math.random(), communication_date: payload.todo_date, student_id: student.id, student_name: student.name, contact_person: student.guardian || "", channel: "工作台同步", category: payload.is_leave ? "请假记录" : "重要通知", title: payload.title, content: payload.detail || payload.requirement || "", status: "待跟进", original_name: todo.credential_name });
          if (payload.is_leave) {
            data.leaveRecords = data.leaveRecords || [];
            data.leaveRecords.unshift({ id: Date.now() + Math.random(), leave_date: payload.todo_date, student_id: student.id, student_no: student.student_no, student_name: student.name, class_name: student.class_name, period_label: payload.leave_period || "全天", leave_type: payload.leave_type || "病假", remark: payload.leave_remark || payload.detail || payload.requirement || "" });
          }
        }
      }
      return save(data);
    },
    updateClassTodo: async (payload) => {
      const data = load();
      data.classTodos = (data.classTodos || []).map((todo) => String(todo.id) === String(payload.id) ? { ...todo, ...payload } : todo);
      return save(data);
    },
    deleteClassTodo: async (payload) => {
      const data = load();
      data.classTodos = (data.classTodos || []).filter((todo) => String(todo.id) !== String(payload.id));
      return save(data);
    },
    addLeaveRecord: async (payload) => {
      const data = load();
      const student = data.students.find((item) => String(item.id) === String(payload.student_id))
        || data.students.find((item) => item.name === payload.student_name || String(item.student_no) === String(payload.student_name));
      data.leaveRecords = data.leaveRecords || [];
      data.leaveRecords.unshift({ ...payload, id: Date.now(), student_id: student?.id || payload.student_id || "", student_no: student?.student_no, student_name: student?.name || payload.student_name || "", class_name: student?.class_name || "" });
      return save(data);
    },
    updateLeaveRecord: async (payload) => {
      const data = load();
      const student = data.students.find((item) => String(item.id) === String(payload.student_id))
        || data.students.find((item) => item.name === payload.student_name || String(item.student_no) === String(payload.student_name));
      data.leaveRecords = (data.leaveRecords || []).map((record) => record.id === payload.id ? { ...record, ...payload, student_no: student?.student_no || record.student_no, student_name: student?.name || record.student_name, class_name: student?.class_name || record.class_name } : record);
      return save(data);
    },
    deleteLeaveRecord: async (payload) => {
      const data = load();
      data.leaveRecords = (data.leaveRecords || []).filter((record) => record.id !== payload.id);
      return save(data);
    },
    addWorkLog: async (payload) => {
      const data = load();
      data.logs = [{
        id: Date.now(),
        log_date: payload.log_date,
        type: payload.type || "班级管理",
        title: payload.title || "",
        content: payload.content || "",
        status: payload.status || "未开始",
        tags: payload.tags || "",
        remark: payload.remark || "",
        requirement: payload.requirement || "",
        evidence_file_id: null,
        evidence_name: payload.evidence_path ? "浏览器演示凭证" : ""
      }, ...(data.logs || [])];
      return save(data);
    },
    updateWorkLog: async (payload) => {
      const data = load();
      data.logs = (data.logs || []).map((log) => log.id === payload.id ? {
        ...log,
        ...payload,
        evidence_name: payload.evidence_path ? "浏览器演示凭证" : log.evidence_name
      } : log);
      return save(data);
    },
    deleteWorkLog: async (payload) => {
      const data = load();
      data.logs = (data.logs || []).filter((log) => log.id !== payload.id);
      return save(data);
    },
    resetSeating: async (payload) => {
      const data = load();
      data.seating = (data.seating || []).filter((item) => item.class_name !== payload.class_name);
      return save(data);
    },
    exportLeaveRecords: async (payload) => {
      console.log("浏览器演示导出请假记录", payload);
      return { preview: true };
    },
    updateStudentRemark: async (payload) => {
      const data = load();
      data.students = data.students.map((student) => String(student.id) === String(payload.id) ? { ...student, student_remark: payload.remark || "" } : student);
      return save(data);
    },
    updateStudentProfile: async (payload) => {
      const data = load();
      data.students = data.students.map((student) => String(student.id) === String(payload.id) ? { ...student, height_cm: payload.height_cm || "", seating_remark: payload.seating_remark || "", is_observed: payload.is_observed ? 1 : 0 } : student);
      return save(data);
    },
    updateStudentRoles: async (payload) => {
      const data = load();
      data.students = data.students.map((student) => String(student.id) === String(payload.id) ? { ...student, roles: payload.roles || "" } : student);
      return save(data);
    },
    readFilePreview: async () => ({ ok: false, reason: "浏览器演示模式不支持读取本地文件，请在桌面应用中查看" }),
    openFileExternal: async () => ({ ok: false, reason: "浏览器演示模式不支持打开本地文件" }),
    assignSeat: async (payload) => {
      const data = load();
      data.seating = data.seating || [];
      data.seating = data.seating.filter((item) => !(item.class_name === payload.class_name && (String(item.student_id) === String(payload.student_id) || item.seat_key === payload.seat_key)));
      if (payload.seat_key) {
        const student = data.students.find((item) => String(item.id) === String(payload.student_id));
        data.seating.push({ ...payload, id: Date.now(), student_name: student?.name || "", student_no: student?.student_no || "", gender: student?.gender || "", height_cm: student?.height_cm || "", seating_remark: student?.seating_remark || "", is_observed: student?.is_observed || 0 });
      }
      return save(data);
    },
    randomizeSeating: async (payload) => {
      const data = load();
      const className = payload.class_name;
      const rows = Math.max(1, Math.min(7, Number(payload.rows || 7)));
      const cols = Math.max(1, Math.min(7, Number(payload.cols || 7)));
      const shuffle = (list) => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      };
      const classStudents = data.students.filter((student) => student.class_name === className);
      const interleaved = [];
      if (payload.order_mode === "student_no") {
        interleaved.push(...classStudents.sort((a, b) => Number(a.student_no || 0) - Number(b.student_no || 0)));
      } else if ((payload.gender_mode || "mixed") === "mixed") {
        const boys = shuffle(classStudents.filter((student) => student.gender === "男"));
        const girls = shuffle(classStudents.filter((student) => student.gender !== "男"));
        const [first, second] = boys.length >= girls.length ? [boys, girls] : [girls, boys];
        first.forEach((student, index) => {
          interleaved.push(student);
          if (second[index]) interleaved.push(second[index]);
        });
      } else {
        interleaved.push(...shuffle(classStudents));
      }
      const seatKeys = [];
      for (let row = 1; row <= rows; row += 1) {
        for (let col = 1; col <= cols; col += 1) seatKeys.push(`r${row}c${col}`);
      }
      data.seating = (data.seating || []).filter((item) => !(item.class_name === className && item.seat_key?.startsWith("r")));
      interleaved.slice(0, seatKeys.length).forEach((student, index) => {
        data.seating.push({ id: Date.now() + index, class_name: className, seat_key: seatKeys[index], student_id: student.id, student_name: student.name, student_no: student.student_no, gender: student.gender, height_cm: student.height_cm, seating_remark: student.seating_remark, is_observed: student.is_observed });
      });
      return save(data);
    },
    rotateSeatingColumns: async (payload) => {
      const data = load();
      const className = payload.class_name;
      data.seating = (data.seating || []).map((item) => {
        if (item.class_name !== className) return item;
        const match = /^r(\d+)c(\d+)$/.exec(item.seat_key || "");
        if (!match) return item;
        const row = Number(match[1]);
        const nextCol = (Number(match[2]) % 7) + 1;
        return { ...item, seat_key: `r${row}c${nextCol}` };
      });
      return save(data);
    },
    saveSeatingSnapshot: async (payload) => {
      const data = load();
      const className = payload.class_name;
      const seats = (data.seating || []).filter((item) => item.class_name === className)
        .map((item) => ({ seat_key: item.seat_key, student_id: item.student_id, student_name: item.student_name, gender: item.gender }));
      data.seatingSnapshots = data.seatingSnapshots || [];
      data.seatingSnapshots.unshift({
        id: Date.now(),
        class_name: className,
        label: (payload.label || "").trim() || `座位表存档 ${new Date().toISOString().slice(0, 10)}`,
        seat_count: seats.length,
        created_at: new Date().toISOString(),
        seats
      });
      return save(data);
    },
    getSeatingSnapshot: async (payload) => {
      const data = load();
      const snapshot = (data.seatingSnapshots || []).find((item) => String(item.id) === String(payload.id));
      if (!snapshot) return { ok: false };
      return { ok: true, id: snapshot.id, className: snapshot.class_name, label: snapshot.label, createdAt: snapshot.created_at, seats: snapshot.seats || [] };
    },
    applySeatingSnapshot: async (payload) => {
      const data = load();
      const snapshot = (data.seatingSnapshots || []).find((item) => String(item.id) === String(payload.id));
      if (!snapshot) return save(data);
      const currentIds = new Set(data.students.filter((student) => student.class_name === snapshot.class_name).map((student) => student.id));
      data.seating = (data.seating || []).filter((item) => item.class_name !== snapshot.class_name);
      (snapshot.seats || []).forEach((seat, index) => {
        if (!currentIds.has(seat.student_id)) return;
        const student = data.students.find((item) => item.id === seat.student_id);
        data.seating.push({ id: Date.now() + index, class_name: snapshot.class_name, seat_key: seat.seat_key, student_id: seat.student_id, student_name: student?.name || seat.student_name, student_no: student?.student_no || "", gender: student?.gender || seat.gender, height_cm: student?.height_cm || "", seating_remark: student?.seating_remark || "", is_observed: student?.is_observed || 0 });
      });
      return save(data);
    },
    addCooperationRecord: async (payload) => {
      const data = load();
      const groups = data.cooperation.groups || [];
      const members = data.cooperation.members || [];
      const group = groups.find((item) => String(item.id) === String(payload.group_id));
      const member = members.find((item) => String(item.student_id) === String(payload.student_id));
      const points = payload.type === "reminder" ? -Math.abs(Number(payload.points || 0)) : Math.abs(Number(payload.points || 0));
      data.cooperation.records.unshift({
        ...payload,
        id: Date.now(),
        points,
        group_name: group?.name || "",
        student_name: member?.name || ""
      });
      return save(data);
    },
    updateCooperationGroup: async (payload) => {
      const data = load();
      data.cooperation.groups = (data.cooperation.groups || []).map((group) => String(group.id) === String(payload.id) ? { ...group, ...payload, photo_name: payload.photo_path ? "浏览器演示照片" : group.photo_name } : group);
      return save(data);
    },
    addCooperationGroup: async (payload) => {
      const data = load();
      data.cooperation.groups = data.cooperation.groups || [];
      data.cooperation.groups.push({
        ...payload,
        id: `preview-${Date.now()}`,
        photo_name: payload.photo_path ? "浏览器演示照片" : ""
      });
      return save(data);
    },
    setCooperationMembers: async (payload) => {
      const data = load();
      const assignments = payload.assignments || {};
      const students = data.students.filter((student) => student.class_name === payload.class_name).map((student) => String(student.id));
      const seen = Object.values(assignments).flat().map(String);
      const duplicated = seen.filter((id, index) => seen.indexOf(id) !== index);
      const missing = students.filter((id) => !seen.includes(id));
      if (duplicated.length) return { ok: false, message: "名单中有学生被重复分组，请先调整后再保存。" };
      if (missing.length) return { ok: false, message: `还有 ${missing.length} 名学生未分组，请补齐后再保存。` };
      data.cooperation.members = (data.cooperation.members || []).filter((member) => member.class_name !== payload.class_name);
      for (const [groupId, studentIds] of Object.entries(assignments)) {
        for (const studentId of studentIds || []) {
          const student = data.students.find((item) => String(item.id) === String(studentId));
          data.cooperation.members.push({ id: Date.now() + Math.random(), group_id: groupId, student_id: student.id, student_no: student.student_no, name: student.name, class_name: student.class_name, role: "" });
        }
      }
      return { ok: true, data: save(data) };
    },
    addCooperationProject: async (payload) => {
      const data = load();
      const groupScores = payload.group_scores || {};
      data.cooperation.projects = data.cooperation.projects || [];
      for (const [groupId, points] of Object.entries(groupScores)) {
        const group = (data.cooperation.groups || []).find((item) => String(item.id) === String(groupId));
        data.cooperation.projects.unshift({
          ...payload,
          id: Date.now() + Math.random(),
          group_id: groupId,
          group_name: group?.name || "",
          points: Number(points || 0),
          period_label: payload.period_label || payload.project_date || "",
          progress: payload.progress || "进行中",
          personal_scores_json: JSON.stringify(payload.personal_scores || {}),
          evaluation_file_name: payload.evaluation_file_path ? "浏览器演示评价表" : ""
        });
      }
      return save(data);
    },
    updateCooperationProject: async (payload) => {
      const data = load();
      const ids = (payload.ids || []).map(String);
      data.cooperation.projects = (data.cooperation.projects || []).map((project) => {
        if (!ids.includes(String(project.id))) return project;
        return {
          ...project,
          ...payload,
          period_label: payload.period_label || project.period_label,
          points: Number(payload.group_scores?.[project.group_id] ?? project.points ?? 0),
          personal_scores_json: JSON.stringify(payload.personal_scores || {})
        };
      });
      return save(data);
    },
    deleteCooperationProject: async (payload) => {
      const data = load();
      const ids = (payload.ids || []).map(String);
      data.cooperation.projects = (data.cooperation.projects || []).filter((project) => !ids.includes(String(project.id)));
      return save(data);
    },
    printStudentRosterPdf: async (payload) => {
      window.print();
      return { preview: true, className: payload?.className };
    },
    exportHomeworkIssues: async (payload) => {
      console.log("浏览器演示导出作业问题清单", payload);
      return { preview: true, count: 0 };
    },
    exportSubjectReview: async (payload) => {
      console.log("浏览器演示导出学科教学复盘", payload);
      return { preview: true, count: 0 };
    },
    exportTaskStudentStatus: async (payload) => {
      console.log("浏览器演示导出完成情况", payload);
      return { preview: true, count: 0 };
    },
    getDataLocation: async () => load().appInfo,
    backupDatabase: async () => ({ preview: true })
  };
}

function hydratePreview(data) {
  const plans = (data.subject?.plans || []).map((plan) => ({ lesson_type: "新授课", ...plan }));
  const homework = (data.subject?.homework || []).map((task) => ({ homework_type: "日常作业", is_done: 0, ...task }));
  const recitations = (data.subject?.recitations || []).map((task) => ({ recitation_type: "背诵", is_done: 0, ...task }));
  const assessments = (data.subject?.assessments || []).map((test) => ({ test_type: "单元测评", excellent_score: 90, pass_score: 60, score_columns: [], ...test }));
  const assessmentScores = (data.subject?.assessmentScores || []).map((score) => ({ breakdown: {}, ...score }));
  const taskStatuses = data.subject?.taskStatuses || [];
  const family = data.familyCommunications || [];
  const classSchedule = data.schedules?.class || [];
  const personalSchedule = data.schedules?.personal || [];
  const students = (data.students || []).map((student) => ({ seating_remark: "", is_observed: 0, ...student }));
  const subject = data.appConfig?.subject || "语文";
  const cooperation = data.cooperation || { groups: [], members: [], records: [], projects: [] };
  const cooperationRecords = cooperation.records || [];
  const cooperationProjects = cooperation.projects || [];
  const cooperationGroups = (cooperation.groups || []).map((group) => {
    const groupRecords = cooperationRecords.filter((record) => String(record.group_id) === String(group.id));
    const groupProjects = cooperationProjects.filter((project) => String(project.group_id) === String(group.id));
    return {
      ...group,
      points: groupRecords.reduce((sum, record) => sum + Number(record.points || 0), 0) + groupProjects.reduce((sum, project) => sum + Number(project.points || 0), 0),
      achievement_count: groupRecords.filter((record) => record.type === "achievement").length,
      reminder_count: groupRecords.filter((record) => record.type === "reminder").length,
      project_count: groupProjects.length
    };
  });
  const cooperationMembers = (cooperation.members || []).map((member) => {
    const memberRecords = cooperationRecords.filter((record) => String(record.student_id) === String(member.student_id));
    return {
      ...member,
      points: memberRecords.reduce((sum, record) => sum + Number(record.points || 0), 0),
      achievement_count: memberRecords.filter((record) => record.type === "achievement").length,
      reminder_count: memberRecords.filter((record) => record.type === "reminder").length
    };
  });

  return {
    ...data,
    students,
    scheduleStats: {
      weeklyTotal: personalSchedule.filter((cell) => cell.title).length,
      todayCourses: personalSchedule.filter((cell) => cell.day_index === 0 && cell.title).length,
      experimentCount: personalSchedule.filter((cell) => cell.title?.includes("监考") || cell.tag?.includes("监考")).length,
      changeCount: data.changes?.length || 0,
      subjectTeachingCount: personalSchedule.filter((cell) => cell.title?.includes(subject)).length,
      classMeetingCount: classSchedule.filter((cell) => cell.title?.includes("班会")).length,
      examDutyCount: personalSchedule.filter((cell) => cell.title?.includes("监考") || cell.tag?.includes("监考")).length
    },
    familyStats: {
      total: family.length,
      homeVisit: family.filter((item) => item.category === "家访").length,
      leaveNotes: family.filter((item) => item.category?.includes("请假")).length,
      pending: family.filter((item) => item.status !== "已完成").length
    },
    familyCommittee: data.familyCommittee || [],
    familyActivities: data.familyActivities || [],
    classTodos: data.classTodos || [],
    leaveRecords: data.leaveRecords || [],
    seating: data.seating || [],
    electives: data.electives || { courses: [], enrollments: [] },
    cooperation: {
      groups: cooperationGroups,
      members: cooperationMembers,
      records: cooperationRecords,
      projects: cooperationProjects,
      stats: {
        groupCount: cooperationGroups.length,
        recordCount: cooperationRecords.length,
        achievementCount: cooperationRecords.filter((record) => record.type === "achievement").length,
        reminderCount: cooperationRecords.filter((record) => record.type === "reminder").length
      }
    },
    subject: {
      ...data.subject,
      plans,
      homework,
      recitations,
      assessments,
      assessmentScores,
      taskStatuses,
      stats: {
        planTotal: plans.length,
        planDone: plans.filter((item) => item.is_done).length,
        homeworkTotal: homework.length,
        homeworkPending: homework.reduce((sum, item) => sum + Math.max(0, item.assigned_count - item.submitted_count), 0),
        homeworkIssue: homework.reduce((sum, item) => sum + Number(item.issue_count || 0), 0)
      }
    }
  };
}

createRoot(document.getElementById("root")).render(<App />);
