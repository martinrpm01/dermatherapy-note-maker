import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PatientArchiveExportResult, PatientArchivePreflightResult, PatientArchiveRestoreBlocker, PatientArchiveRestoreResult, PatientArchiveValidationIssue } from "../../shared/archive";
import { TEMPLATE_PLACEHOLDERS } from "../../shared/templates";
import type {
  AppClient,
  ArchiveSnapshot,
  AssetReference,
  DashboardSnapshot,
  DocumentOnlySnapshot,
  PatientDetail,
  SettingsPayload,
  TemplateDefinitionRecord,
  AppSettingsView,
  AppUpdateCheckResult
} from "../../shared/types";
import { NOTE_TYPE_LABELS, formatBloodPressure, formatDisplayDate, formatHeartRate, formatOxygenSaturation, formatWeight } from "../../shared/note-rules";
import { useResolvedAssetUrl } from "./asset-url";

function patientDisplayName(detail: PatientDetail["patient"]) {
  return `${detail.lastName}, ${detail.firstName}`;
}

function matchesSearch(value: string, search: string) {
  if (!search.trim()) {
    return true;
  }

  return value.toLowerCase().includes(search.trim().toLowerCase());
}

function comparePatientRowsByName(
  left: { patientName: string; patientMrn: string },
  right: { patientName: string; patientMrn: string }
) {
  return `${left.patientName}|${left.patientMrn}`.localeCompare(
    `${right.patientName}|${right.patientMrn}`,
    undefined,
    { sensitivity: "base", numeric: true }
  );
}

function isDashboardCourseRow(
  row: DashboardSnapshot["activeCourses"][number] | DashboardSnapshot["patientsWithoutCourse"][number]
): row is DashboardSnapshot["activeCourses"][number] {
  return "courseId" in row;
}

function buildActiveSearchMatches(dashboard: DashboardSnapshot | null, search: string) {
  if (!search.trim() || !dashboard) {
    return [];
  }

  const rows = [...dashboard.activeCourses, ...dashboard.pendingCourses, ...dashboard.patientsWithoutCourse];
  const seen = new Set<string>();

  return rows.filter((row) => {
    if (seen.has(row.patientId)) {
      return false;
    }
    seen.add(row.patientId);
    const courseText = "courseId" in row ? `${row.courseName} ${row.siteSummary}` : "";
    return matchesSearch(`${row.patientName} ${row.patientMrn} ${courseText}`, search);
  });
}

function buildPatientDetailMatches(details: PatientDetail[], search: string) {
  if (!search.trim()) {
    return [];
  }

  return details.filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((course) => course.course.courseName).join(" ")}`,
      search
    )
  );
}

function CourseScheduleMenu(props: {
  hasSchedule: boolean;
  onOpenSchedule: () => void;
  onPrintSchedule: () => void;
  onDeleteSchedule: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function runAction(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="course-schedule-menu" ref={menuRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className="course-schedule-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        Schedule
      </button>
      {open ? (
        <div className="course-schedule-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => runAction(props.onOpenSchedule)}>
            {props.hasSchedule ? "Create / Edit Schedule" : "Create Schedule"}
          </button>
          {props.hasSchedule ? (
            <>
              <button type="button" role="menuitem" onClick={() => runAction(props.onPrintSchedule)}>
                Print Schedule
              </button>
              <button type="button" role="menuitem" className="danger-action" onClick={() => runAction(props.onDeleteSchedule)}>
                Delete Schedule
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type BlockedPreflightSection = {
  title: string;
  items: string[];
  guidance: string[];
};

function getPathFileName(value: string) {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || value;
}

function parseMmDdYyyy(display: string): string {
  const digits = display.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const iso = `${yyyy}-${mm}-${dd}`;
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return "";
  return iso;
}

function formatDigitsAsDate(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

export type TouchOptimizedInputEnvironment = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  isElectronDesktop?: boolean;
};

export function shouldUseTouchOptimizedInputsForEnvironment(environment: TouchOptimizedInputEnvironment): boolean {
  if (environment.isElectronDesktop) {
    return false;
  }

  const userAgent = environment.userAgent ?? "";
  const platform = environment.platform ?? "";
  const touchPoints = environment.maxTouchPoints ?? 0;

  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1);
}

function shouldUseTouchOptimizedInputs(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return shouldUseTouchOptimizedInputsForEnvironment({
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
    isElectronDesktop: Boolean(window.rtNoteApi)
  });
}

function refocusEditableInput(event: ReactPointerEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  requestAnimationFrame(() => {
    if (document.activeElement !== input) {
      input.focus();
    }
  });
}

function normalizeBloodPressureEditableValue(value: string) {
  const cleaned = value.replace(/[^\d/]/g, "");
  const slashIndex = cleaned.indexOf("/");
  if (slashIndex === -1) {
    return cleaned;
  }
  return `${cleaned.slice(0, slashIndex).replace(/\//g, "")}/${cleaned.slice(slashIndex + 1).replace(/\//g, "")}`;
}

function toEditableBloodPressureValue(value: string) {
  return value.replace(/\s*mmhg\s*$/i, "").trim();
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatLesionSize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const mmMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return `${mmMatch[1]}mm`;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}mm`;
  }

  return normalized;
}

function findScrollableParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function clearNumPadViewportState() {
  document.body.classList.remove("numpad-open");
  document.querySelector(".lock-shell")?.classList.remove("numpad-open-context");
  document.documentElement.style.removeProperty("--numpad-offset");
}

let activeNumPadFieldId: string | null = null;
let numPadFieldCounter = 0;
const numPadFieldListeners = new Set<() => void>();

function setActiveNumPadField(nextId: string | null) {
  if (activeNumPadFieldId === nextId) {
    return;
  }

  activeNumPadFieldId = nextId;
  numPadFieldListeners.forEach((listener) => listener());
}

function useNumPadActivation(fieldId: string) {
  const [isActive, setIsActive] = useState(() => activeNumPadFieldId === fieldId);

  useEffect(() => {
    const listener = () => setIsActive(activeNumPadFieldId === fieldId);
    numPadFieldListeners.add(listener);
    return () => {
      numPadFieldListeners.delete(listener);
    };
  }, [fieldId]);

  return {
    isActive,
    activate: () => setActiveNumPadField(fieldId),
    deactivate: () => {
      if (activeNumPadFieldId === fieldId) {
        setActiveNumPadField(null);
      }
    }
  };
}

function useNumPadField() {
  const fieldIdRef = useRef<string | null>(null);
  if (!fieldIdRef.current) {
    numPadFieldCounter += 1;
    fieldIdRef.current = `numpad-field-${numPadFieldCounter}`;
  }

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const repositionTimeoutRef = useRef<number | null>(null);
  const [allSelected, setAllSelected] = useState(false);
  const activation = useNumPadActivation(fieldIdRef.current!);

  function positionFieldIntoView() {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    if (wrapper.closest(".modal-backdrop")) {
      return;
    }

    const panel = document.querySelector<HTMLElement>(".numpad-panel");
    const dockHeight = (panel?.getBoundingClientRect().height ?? 220) + 24;
    document.documentElement.style.setProperty("--numpad-offset", `${dockHeight}px`);
    const lockShell = wrapper.closest<HTMLElement>(".lock-shell");

    if (lockShell) {
      lockShell.classList.add("numpad-open-context");
      document.body.classList.remove("numpad-open");
    } else {
      document.body.classList.add("numpad-open");
      document.querySelector(".lock-shell")?.classList.remove("numpad-open-context");
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const visibleTop = 24;
    const visibleBottom = window.innerHeight - dockHeight - 16;

    if (wrapperRect.top >= visibleTop && wrapperRect.bottom <= visibleBottom) {
      return;
    }

    const scrollParent = findScrollableParent(wrapper);
    const delta =
      wrapperRect.bottom > visibleBottom
        ? wrapperRect.bottom - visibleBottom
        : wrapperRect.top - visibleTop;

    if (scrollParent) {
      scrollParent.scrollBy({ top: delta, behavior: "auto" });
    } else {
      window.scrollBy({ top: delta, behavior: "auto" });
    }
  }

  function scheduleReposition() {
    if (repositionTimeoutRef.current !== null) {
      window.clearTimeout(repositionTimeoutRef.current);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(positionFieldIntoView);
    });

    repositionTimeoutRef.current = window.setTimeout(() => {
      requestAnimationFrame(positionFieldIntoView);
      repositionTimeoutRef.current = null;
    }, 120);
  }

  useEffect(() => {
    if (!activation.isActive) {
      setAllSelected(false);
    }
  }, [activation.isActive]);

  useEffect(() => {
    if (!activation.isActive) {
      if (!activeNumPadFieldId) {
        clearNumPadViewportState();
      }
      return;
    }

    scheduleReposition();

    return () => {
      if (repositionTimeoutRef.current !== null) {
        window.clearTimeout(repositionTimeoutRef.current);
        repositionTimeoutRef.current = null;
      }
      if (!activeNumPadFieldId) {
        clearNumPadViewportState();
      }
    };
  }, [activation.isActive]);

  function focusInput(selectAll = false) {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      if (selectAll && input.value) {
        input.select();
      }
    });
  }

  function open() {
    setAllSelected(false);
    activation.activate();
    scheduleReposition();
    focusInput(false);
  }

  function clearSelection() {
    setAllSelected(false);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
  }

  function handleInputPointerDown(event: ReactPointerEvent<HTMLInputElement>) {
    event.preventDefault();
    if (activation.isActive && inputRef.current?.value) {
      setAllSelected(true);
      activation.activate();
      focusInput(true);
      return;
    }
    open();
  }

  function handleInputFocus() {
    if (!activation.isActive) {
      open();
    }
  }

  return {
    isActive: activation.isActive,
    wrapperRef,
    inputRef,
    allSelected,
    close: activation.deactivate,
    refreshPosition: scheduleReposition,
    clearSelection,
    handleInputPointerDown,
    handleInputFocus
  };
}

function DockedNumPad(props: {
  anchorRef: RefObject<HTMLElement | null>;
  onPress: (c: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onClose: () => void;
  closeLabel?: string;
  extraKey?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (props.anchorRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }

      props.onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [props]);

  useEffect(() => {
    function preventScroll(event: TouchEvent | WheelEvent) {
      event.preventDefault();
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    panel.addEventListener("touchmove", preventScroll, { passive: false });
    panel.addEventListener("wheel", preventScroll, { passive: false });
    return () => {
      panel.removeEventListener("touchmove", preventScroll);
      panel.removeEventListener("wheel", preventScroll);
    };
  }, []);

  function renderButton(label: string, handler: () => void, className?: string) {
    return (
      <button
        key={label}
        type="button"
        className={className}
        onPointerDown={(event) => {
          event.preventDefault();
          handler();
        }}
      >
        {label}
      </button>
    );
  }

  return createPortal(
    <div className="numpad-dock">
      <div ref={panelRef} className="numpad-panel">
        <div className="numpad-toolbar">
          {renderButton("Clear", props.onClear, "numpad-toolbar-button")}
          {props.extraKey ? renderButton(props.extraKey, () => props.onPress(props.extraKey!), "numpad-toolbar-button") : null}
        </div>
        <div className="numpad">
          {"123456789".split("").map((digit) => renderButton(digit, () => props.onPress(digit)))}
          {renderButton(props.closeLabel ?? "Done", props.onClose, "numpad-button-primary")}
          {renderButton("0", () => props.onPress("0"))}
          {renderButton("Del", props.onBackspace)}
        </div>
      </div>
    </div>,
    document.body
  );
}

export type LogoCropShape = "wide" | "square";

export interface LogoCropSelection {
  shape: LogoCropShape;
  outputWidth: number;
  outputHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function LogoCropModal(props: {
  sourceDataUrl: string;
  onCancel: () => void;
  onConfirm: (selection: LogoCropSelection) => void;
}) {
  const [shape, setShape] = useState<LogoCropShape>("wide");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [frameWidth, setFrameWidth] = useState(520);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const aspectRatio = shape === "square" ? 1 : 16 / 5;
  const outputSize = shape === "square"
    ? { width: 900, height: 900 }
    : { width: 1280, height: 400 };
  const frameHeight = frameWidth / aspectRatio;

  useEffect(() => {
    function measureFrame() {
      const width = frameRef.current?.clientWidth;
      if (!width) {
        return;
      }
      setFrameWidth(width);
    }

    measureFrame();
    window.addEventListener("resize", measureFrame);
    return () => window.removeEventListener("resize", measureFrame);
  }, []);

  function getScaledMetrics(nextZoom = zoom) {
    if (!imageSize) {
      return null;
    }

    const baseScale = Math.max(frameWidth / imageSize.width, frameHeight / imageSize.height);
    const scale = baseScale * nextZoom;
    const scaledWidth = imageSize.width * scale;
    const scaledHeight = imageSize.height * scale;
    const maxOffsetX = Math.max(0, (scaledWidth - frameWidth) / 2);
    const maxOffsetY = Math.max(0, (scaledHeight - frameHeight) / 2);

    return {
      scale,
      scaledWidth,
      scaledHeight,
      maxOffsetX,
      maxOffsetY
    };
  }

  function clampOffset(nextOffset: { x: number; y: number }, nextZoom = zoom) {
    const metrics = getScaledMetrics(nextZoom);
    if (!metrics) {
      return nextOffset;
    }

    return {
      x: clamp(nextOffset.x, -metrics.maxOffsetX, metrics.maxOffsetX),
      y: clamp(nextOffset.y, -metrics.maxOffsetY, metrics.maxOffsetY)
    };
  }

  function buildCropSelection(nextOffset = offset, nextZoom = zoom): LogoCropSelection | null {
    const metrics = getScaledMetrics(nextZoom);
    if (!metrics || !imageSize) {
      return null;
    }
    const scaleToOutput = outputSize.width / frameWidth;
    const imageLeft = ((frameWidth - metrics.scaledWidth) / 2) + nextOffset.x;
    const imageTop = ((frameHeight - metrics.scaledHeight) / 2) + nextOffset.y;

    return {
      shape,
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      imageX: imageLeft * scaleToOutput,
      imageY: imageTop * scaleToOutput,
      imageWidth: metrics.scaledWidth * scaleToOutput,
      imageHeight: metrics.scaledHeight * scaleToOutput
    };
  }

  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [frameWidth, frameHeight, imageSize, zoom]);

  const metrics = getScaledMetrics();
  const imageLeft = metrics ? ((frameWidth - metrics.scaledWidth) / 2) + offset.x : 0;
  const imageTop = metrics ? ((frameHeight - metrics.scaledHeight) / 2) + offset.y : 0;
  const previewSelection = buildCropSelection();
  const previewWidth = 220;
  const previewScale = previewSelection ? previewWidth / previewSelection.outputWidth : 1;

  return (
    <div className="modal-backdrop">
      <div className="modal-card wide logo-crop-modal">
        <h3>Crop Logo</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Drag the logo until it looks right inside the blue frame. The shaded outer area will not be shown.
        </p>
        <div className="logo-crop-layout">
          <div className="logo-crop-workspace">
            <div className="logo-crop-stage">
              <div className="button-row logo-crop-shape-toggle">
                <button
                  type="button"
                  className={shape === "wide" ? "primary" : ""}
                  onClick={() => {
                    setShape("wide");
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                >
                  Wide Logo
                </button>
                <button
                  type="button"
                  className={shape === "square" ? "primary" : ""}
                  onClick={() => {
                    setShape("square");
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                >
                  Square Logo
                </button>
              </div>
              <div className="logo-crop-stage-copy">
                Visible logo area
              </div>
              <div className="logo-crop-field">
                <div
                  ref={frameRef}
                  className="logo-crop-frame"
                  style={{ aspectRatio: `${aspectRatio}` }}
                  onPointerDown={(event) => {
                    if (!metrics) {
                      return;
                    }
                    event.preventDefault();
                    dragStateRef.current = {
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      offsetX: offset.x,
                      offsetY: offset.y
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const drag = dragStateRef.current;
                    if (!drag || drag.pointerId !== event.pointerId) {
                      return;
                    }
                    event.preventDefault();
                    setOffset(clampOffset({
                      x: drag.offsetX + (event.clientX - drag.startX),
                      y: drag.offsetY + (event.clientY - drag.startY)
                    }));
                  }}
                  onPointerUp={(event) => {
                    if (dragStateRef.current?.pointerId === event.pointerId) {
                      dragStateRef.current = null;
                    }
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerCancel={(event) => {
                    if (dragStateRef.current?.pointerId === event.pointerId) {
                      dragStateRef.current = null;
                    }
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                >
                  <img
                    className="logo-crop-image"
                    src={props.sourceDataUrl}
                    alt="Logo crop preview"
                    draggable={false}
                    onLoad={(event) => {
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight
                      });
                    }}
                    style={metrics ? {
                      width: `${metrics.scaledWidth}px`,
                      height: `${metrics.scaledHeight}px`,
                      left: `${imageLeft}px`,
                      top: `${imageTop}px`
                    } : undefined}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="logo-crop-sidebar">
            <div className="logo-crop-preview-card">
              <span className="strong">Live Preview</span>
              <div className="logo-crop-preview-window" style={{ aspectRatio: `${aspectRatio}` }}>
                {previewSelection ? (
                  <div
                    className="logo-crop-preview-image"
                    style={{
                      backgroundImage: `url(${props.sourceDataUrl})`,
                      backgroundSize: `${previewSelection.imageWidth * previewScale}px ${previewSelection.imageHeight * previewScale}px`,
                      backgroundPosition: `${previewSelection.imageX * previewScale}px ${previewSelection.imageY * previewScale}px`
                    }}
                  />
                ) : null}
              </div>
            </div>
            <label className="logo-crop-zoom">
              Zoom
              <input
                type="range"
                min="0.45"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(event) => {
                  const nextZoom = Number(event.target.value);
                  setZoom(nextZoom);
                  setOffset((current) => clampOffset(current, nextZoom));
                }}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
              >
                Re-center
              </button>
              <button type="button" onClick={props.onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!previewSelection}
                onClick={() => {
                  const selection = buildCropSelection();
                  if (!selection) {
                    return;
                  }
                  props.onConfirm(selection);
                }}
              >
                Use Crop
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumPadToReplace({ onPress, onBackspace, extraKey }: { onPress: (c: string) => void; onBackspace: () => void; extraKey?: string }) {
  function btn(label: string, handler: () => void) {
    return (
      <button key={label} type="button" onPointerDown={(e) => { e.preventDefault(); handler(); }}>
        {label}
      </button>
    );
  }
  return (
    <div className="numpad">
      {"123456789".split("").map((d) => btn(d, () => onPress(d)))}
      {extraKey ? btn(extraKey, () => onPress(extraKey)) : <span />}
      {btn("0", () => onPress("0"))}
      {btn("⌫", onBackspace)}
    </div>
  );
}

function DesktopDateInput(props: { value: string; onChange: (value: string) => void }) {
  const [displayValue, setDisplayValue] = useState(() => props.value ? formatDisplayDate(props.value) : "");

  useEffect(() => {
    setDisplayValue(props.value ? formatDisplayDate(props.value) : "");
  }, [props.value]);

  function handleChange(value: string) {
    const digits = digitsOnly(value).slice(0, 8);
    const formatted = formatDigitsAsDate(digits);
    setDisplayValue(formatted);
    if (digits.length === 0 || digits.length === 8) {
      props.onChange(digits.length === 8 ? parseMmDdYyyy(formatted) : "");
    }
  }

  function handleBlur() {
    const parsed = parseMmDdYyyy(displayValue);
    if (!parsed) {
      props.onChange("");
    }
    setDisplayValue(parsed ? formatDisplayDate(parsed) : displayValue.trim());
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="MM/DD/YYYY"
      value={displayValue}
      onPointerDown={refocusEditableInput}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
    />
  );
}

function TouchDateInput(props: { value: string; onChange: (value: string) => void }) {
  const [displayValue, setDisplayValue] = useState(() => props.value ? formatDisplayDate(props.value) : "");
  const field = useNumPadField();

  useEffect(() => {
    if (!field.isActive) {
      setDisplayValue(props.value ? formatDisplayDate(props.value) : "");
    }
  }, [field.isActive, props.value]);

  function updateFromDigits(digits: string) {
    const limitedDigits = digits.slice(0, 8);
    const formatted = formatDigitsAsDate(limitedDigits);
    setDisplayValue(formatted);
    props.onChange(limitedDigits.length === 8 ? parseMmDdYyyy(formatted) : "");
    field.refreshPosition();
  }

  function handlePress(digit: string) {
    const baseDigits = field.allSelected ? "" : displayValue.replace(/\D/g, "");
    const nextDigits = (baseDigits + digit).slice(0, 8);
    field.clearSelection();
    updateFromDigits(nextDigits);
  }

  function handleBackspace() {
    const nextDigits = field.allSelected ? "" : displayValue.replace(/\D/g, "").slice(0, -1);
    field.clearSelection();
    updateFromDigits(nextDigits);
  }

  function handleClear() {
    field.clearSelection();
    updateFromDigits("");
  }

  return (
    <div ref={field.wrapperRef} className={`numpad-field${field.isActive ? " is-active" : ""}`}>
      <input
        ref={field.inputRef}
        type="text"
        readOnly
        placeholder="MM/DD/YYYY"
        value={displayValue}
        onPointerDown={field.handleInputPointerDown}
        onFocus={field.handleInputFocus}
      />
      {field.isActive ? (
        <DockedNumPad
          anchorRef={field.wrapperRef}
          onPress={handlePress}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onClose={field.close}
        />
      ) : null}
    </div>
  );
}

export function DobInput(props: { value: string; onChange: (value: string) => void }) {
  return shouldUseTouchOptimizedInputs() ? <TouchDateInput {...props} /> : <DesktopDateInput {...props} />;
}

export function VisitDateInput(props: { value: string; onChange: (value: string) => void }) {
  return <DobInput {...props} />;
}

export function CalendarDateInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="date"
      value={props.value || ""}
      onPointerDown={refocusEditableInput}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function DesktopBloodPressureInput(props: { value: string; onChange: (value: string) => void }) {
  const [displayValue, setDisplayValue] = useState(() => toEditableBloodPressureValue(props.value));

  useEffect(() => {
    setDisplayValue(toEditableBloodPressureValue(props.value));
  }, [props.value]);

  function handleChange(value: string) {
    const next = normalizeBloodPressureEditableValue(value);
    setDisplayValue(next);
    props.onChange(next);
  }

  function handleBlur() {
    const formatted = formatBloodPressure(displayValue);
    props.onChange(formatted);
    setDisplayValue(toEditableBloodPressureValue(formatted));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="e.g. 120/80"
      value={displayValue}
      onPointerDown={refocusEditableInput}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
    />
  );
}

function TouchBloodPressureInput(props: { value: string; onChange: (value: string) => void }) {
  const [displayValue, setDisplayValue] = useState(() => toEditableBloodPressureValue(props.value));
  const field = useNumPadField();

  useEffect(() => {
    if (!field.isActive) setDisplayValue(toEditableBloodPressureValue(props.value));
  }, [field.isActive, props.value]);

  function syncValue(next: string, closeAfterSync = false) {
    setDisplayValue(next);
    props.onChange(next);
    field.refreshPosition();
    if (closeAfterSync) {
      props.onChange(formatBloodPressure(next));
      field.close();
    }
  }

  function handlePress(character: string) {
    const currentValue = normalizeBloodPressureEditableValue(field.allSelected ? "" : displayValue);
    let next = currentValue;

    if (character === "/") {
      if (!currentValue.includes("/")) {
        const digits = currentValue.replace(/\D/g, "");
        next = digits ? `${digits}/` : currentValue;
      }
    } else {
      const digitsOnly = currentValue.replace(/\D/g, "");
      if (!currentValue.includes("/") && digitsOnly.length === 3) {
        next = `${digitsOnly}/${character}`;
      } else {
        next = `${currentValue}${character}`;
      }
    }

    field.clearSelection();
    syncValue(normalizeBloodPressureEditableValue(next), false);
  }

  function handleBackspace() {
    const next = field.allSelected ? "" : displayValue.slice(0, -1);
    field.clearSelection();
    syncValue(next);
  }

  function handleClear() {
    field.clearSelection();
    syncValue("");
  }

  function handleClose() {
    props.onChange(formatBloodPressure(displayValue));
    field.close();
  }

  return (
    <div ref={field.wrapperRef} className={`numpad-field${field.isActive ? " is-active" : ""}`}>
      <input
        ref={field.inputRef}
        type="text"
        readOnly
        placeholder="e.g. 120/80"
        value={displayValue}
        onPointerDown={field.handleInputPointerDown}
        onFocus={field.handleInputFocus}
      />
      {field.isActive ? (
        <DockedNumPad
          anchorRef={field.wrapperRef}
          onPress={handlePress}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onClose={handleClose}
          extraKey="/"
        />
      ) : null}
    </div>
  );
}

export function BloodPressureInput(props: { value: string; onChange: (value: string) => void }) {
  return shouldUseTouchOptimizedInputs() ? <TouchBloodPressureInput {...props} /> : <DesktopBloodPressureInput {...props} />;
}

function DesktopNumericInput(props: { value: string | number; onChange: (value: string) => void; placeholder?: string }) {
  const display = props.value === "" || props.value == null ? "" : String(props.value);

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={props.placeholder}
      value={display}
      onPointerDown={refocusEditableInput}
      onChange={(event) => props.onChange(digitsOnly(event.target.value))}
    />
  );
}

function TouchNumericInput(props: { value: string | number; onChange: (value: string) => void; placeholder?: string }) {
  const field = useNumPadField();
  const display = props.value === "" || props.value == null ? "" : String(props.value);

  function handlePress(digit: string) {
    const next = `${field.allSelected ? "" : display}${digit}`;
    field.clearSelection();
    props.onChange(next);
    field.refreshPosition();
  }

  function handleBackspace() {
    const next = field.allSelected ? "" : display.slice(0, -1);
    field.clearSelection();
    props.onChange(next);
    field.refreshPosition();
  }

  function handleClear() {
    field.clearSelection();
    props.onChange("");
    field.refreshPosition();
  }

  return (
    <div ref={field.wrapperRef} className={`numpad-field${field.isActive ? " is-active" : ""}`}>
      <input
        ref={field.inputRef}
        type="text"
        readOnly
        placeholder={props.placeholder}
        value={display}
        onPointerDown={field.handleInputPointerDown}
        onFocus={field.handleInputFocus}
      />
      {field.isActive ? (
        <DockedNumPad
          anchorRef={field.wrapperRef}
          onPress={handlePress}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onClose={field.close}
        />
      ) : null}
    </div>
  );
}

export function NumericInput(props: { value: string | number; onChange: (value: string) => void; placeholder?: string }) {
  return shouldUseTouchOptimizedInputs() ? <TouchNumericInput {...props} /> : <DesktopNumericInput {...props} />;
}

function FormattedNumericInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  toEditable: (value: string) => string;
  formatter: (value: string) => string;
}) {
  return shouldUseTouchOptimizedInputs()
    ? <TouchFormattedNumericInput {...props} />
    : <DesktopFormattedNumericInput {...props} />;
}

function DesktopFormattedNumericInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  toEditable: (value: string) => string;
  formatter: (value: string) => string;
}) {
  const [displayValue, setDisplayValue] = useState(() => props.toEditable(props.value));

  useEffect(() => {
    setDisplayValue(props.toEditable(props.value));
  }, [props.value, props.toEditable]);

  function handleChange(value: string) {
    const next = digitsOnly(value);
    setDisplayValue(next);
    props.onChange(next);
  }

  function handleBlur() {
    const formatted = props.formatter(displayValue);
    props.onChange(formatted);
    setDisplayValue(props.toEditable(formatted));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={props.placeholder}
      value={displayValue}
      onPointerDown={refocusEditableInput}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
    />
  );
}

function TouchFormattedNumericInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  toEditable: (value: string) => string;
  formatter: (value: string) => string;
}) {
  const [displayValue, setDisplayValue] = useState(() => props.toEditable(props.value));
  const field = useNumPadField();

  useEffect(() => {
    if (!field.isActive) {
      setDisplayValue(props.toEditable(props.value));
    }
  }, [field.isActive, props.value, props.toEditable]);

  function syncValue(next: string) {
    setDisplayValue(next);
    props.onChange(next);
    field.refreshPosition();
  }

  function handlePress(digit: string) {
    const next = `${field.allSelected ? "" : displayValue}${digit}`;
    field.clearSelection();
    syncValue(next);
  }

  function handleBackspace() {
    const next = field.allSelected ? "" : displayValue.slice(0, -1);
    field.clearSelection();
    syncValue(next);
  }

  function handleClear() {
    field.clearSelection();
    syncValue("");
  }

  function handleClose() {
    props.onChange(props.formatter(displayValue));
    field.close();
  }

  return (
    <div ref={field.wrapperRef} className={`numpad-field${field.isActive ? " is-active" : ""}`}>
      <input
        ref={field.inputRef}
        type="text"
        readOnly
        placeholder={props.placeholder}
        value={displayValue}
        onPointerDown={field.handleInputPointerDown}
        onFocus={field.handleInputFocus}
      />
      {field.isActive ? (
        <DockedNumPad
          anchorRef={field.wrapperRef}
          onPress={handlePress}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onClose={handleClose}
        />
      ) : null}
    </div>
  );
}

export function HeartRateInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <FormattedNumericInput
      value={props.value}
      onChange={props.onChange}
      placeholder="e.g. 72 BPM"
      toEditable={(value) => value.replace(/\s*bpm\s*$/i, "").trim()}
      formatter={formatHeartRate}
    />
  );
}

export function OxygenSaturationInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <FormattedNumericInput
      value={props.value}
      onChange={props.onChange}
      placeholder="e.g. 98%"
      toEditable={(value) => value.replace(/\s*%\s*$/i, "").trim()}
      formatter={formatOxygenSaturation}
    />
  );
}

export function WeightInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <FormattedNumericInput
      value={props.value}
      onChange={props.onChange}
      placeholder="e.g. 165 lbs"
      toEditable={(value) => value.replace(/\s*lbs?\s*$/i, "").trim()}
      formatter={formatWeight}
    />
  );
}

export function LesionSizeInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <FormattedNumericInput
      value={props.value}
      onChange={props.onChange}
      placeholder="e.g. 10mm"
      toEditable={(value) => value.replace(/\s*mm\s*$/i, "").trim()}
      formatter={formatLesionSize}
    />
  );
}

function DesktopPinInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; onDone?: () => void }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      placeholder={props.placeholder ?? "PIN"}
      value={props.value}
      onPointerDown={refocusEditableInput}
      onChange={(event) => props.onChange(digitsOnly(event.target.value).slice(0, 8))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          props.onDone?.();
        }
      }}
    />
  );
}

function TouchPinInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; onDone?: () => void }) {
  const field = useNumPadField();

  function handlePress(digit: string) {
    const next = `${field.allSelected ? "" : props.value}${digit}`.slice(0, 8);
    field.clearSelection();
    props.onChange(next);
    field.refreshPosition();
    if (next.length >= 8) {
      field.close();
    }
  }

  function handleBackspace() {
    const next = field.allSelected ? "" : props.value.slice(0, -1);
    field.clearSelection();
    props.onChange(next);
    field.refreshPosition();
  }

  function handleClear() {
    field.clearSelection();
    props.onChange("");
    field.refreshPosition();
  }

  function handleDone() {
    field.close();
    props.onDone?.();
  }

  return (
    <div ref={field.wrapperRef} className={`numpad-field${field.isActive ? " is-active" : ""}`}>
      <input
        ref={field.inputRef}
        type="password"
        readOnly
        autoComplete="off"
        placeholder={props.placeholder ?? "PIN"}
        value={props.value}
        onPointerDown={field.handleInputPointerDown}
        onFocus={field.handleInputFocus}
      />
      {field.isActive ? (
        <DockedNumPad
          anchorRef={field.wrapperRef}
          onPress={handlePress}
          onBackspace={handleBackspace}
          onClear={handleClear}
          onClose={handleDone}
        />
      ) : null}
    </div>
  );
}

export function PinInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; onDone?: () => void }) {
  return shouldUseTouchOptimizedInputs() ? <TouchPinInput {...props} /> : <DesktopPinInput {...props} />;
}

function formatRestoreModeLabel(result: PatientArchivePreflightResult) {
  if (result.restoreMode === "merge_existing_patient") {
    return `Merge completed history into existing patient ${result.targetPatientId}`;
  }

  if (result.restoreMode === "new_patient") {
    return `Restore as patient ${result.targetPatientId}`;
  }

  return "Not restorable in the current phase";
}

function ArchivePathSummary(props: {
  fileLabel?: string;
  fileName: string;
  pathLabel: string;
  pathValue: string;
}) {
  return (
    <div className="muted" style={{ fontSize: "0.9rem", marginBottom: "0.8rem" }}>
      <div>{props.fileLabel ?? "Archive file"}: {props.fileName}</div>
      <div>{props.pathLabel}: {props.pathValue}</div>
    </div>
  );
}

function ArchiveCountSummary(props: {
  title: string;
  lines: string[];
  marginBottom?: string;
}) {
  return (
    <div style={{ marginBottom: props.marginBottom ?? "0.8rem" }}>
      <strong>{props.title}</strong>
      <div className="muted" style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
        {props.lines.map((line, index) => (
          <div key={`${props.title}-${index}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function PatientAvatar(props: {
  appClient: AppClient | null;
  asset: AssetReference | null | undefined;
}) {
  const src = useResolvedAssetUrl(props.appClient, props.asset);
  return src ? <img className="patient-row-avatar" src={src} alt="" /> : <div className="patient-row-avatar-placeholder" />;
}

function categorizeValidationIssue(issue: PatientArchiveValidationIssue) {
  switch (issue.code) {
    case "archive_open_failed":
    case "json_parse_failed":
    case "invalid_json_shape":
    case "invalid_archive_type":
      return "invalid_archive";
    case "unsupported_archive_version":
      return "unsupported_archive";
    case "missing_required_entry":
    case "missing_asset_file_entry":
      return "missing_archive_contents";
  }
}

function categorizeRestoreBlocker(blocker: PatientArchiveRestoreBlocker) {
  switch (blocker.code) {
    case "invalid_archive":
      return "invalid_archive";
    case "missing_asset_entry":
      return "missing_archive_contents";
    case "active_course_not_supported":
      return "active_course_blocked";
    case "ambiguous_patient_identity":
    case "conflicting_patient_id":
    case "conflicting_patient_identity":
    case "conflicting_course_id":
    case "conflicting_site_id":
    case "conflicting_visit_id":
    case "conflicting_visit_photo_id":
    case "conflicting_visit_attachment_id":
    case "conflicting_generated_pdf_id":
    case "conflicting_generated_pdf_output_path":
      return "merge_conflict_blocked";
  }
}

function buildBlockedPreflightSections(preflightResult: PatientArchivePreflightResult): BlockedPreflightSection[] {
  const buckets = new Map<string, BlockedPreflightSection>();

  const ensureBucket = (key: string, title: string, guidance: string[]) => {
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }

    const created: BlockedPreflightSection = { title, items: [], guidance };
    buckets.set(key, created);
    return created;
  };

  for (const issue of preflightResult.validationIssues) {
    const category = categorizeValidationIssue(issue);
    if (!category) {
      continue;
    }

    switch (category) {
      case "invalid_archive":
        ensureBucket(
          category,
          "Invalid Archive",
          [
            "Use a patient archive ZIP created by ClearSkin Hub.",
            "If this ZIP was edited, re-export the patient archive from the source device before trying again."
          ]
        ).items.push(issue.message);
        break;
      case "unsupported_archive":
        ensureBucket(
          category,
          "Unsupported Archive Version",
          [
            "Use a restore archive created by a compatible version of ClearSkin Hub.",
            "If the source device is ahead of this app version, update this desktop app before retrying."
          ]
        ).items.push(issue.message);
        break;
      case "missing_archive_contents":
        ensureBucket(
          category,
          "Missing Archive Contents",
          [
            "Pick a complete patient archive ZIP and avoid manually editing its contents.",
            "If the archive came from another device, re-export it so all required files are bundled."
          ]
        ).items.push(issue.message);
        break;
    }
  }

  for (const blocker of preflightResult.restoreBlockers) {
    const category = categorizeRestoreBlocker(blocker);
    if (!category) {
      continue;
    }

    switch (category) {
      case "invalid_archive":
        ensureBucket(
          category,
          "Invalid Archive",
          [
            "Use a patient archive ZIP created by ClearSkin Hub.",
            "If this ZIP was edited, re-export the patient archive from the source device before trying again."
          ]
        ).items.push(blocker.message);
        break;
      case "missing_archive_contents":
        ensureBucket(
          category,
          "Missing Archive Contents",
          [
            "Pick a complete patient archive ZIP and avoid manually editing its contents.",
            "If the archive came from another device, re-export it so all required files are bundled."
          ]
        ).items.push(blocker.message);
        break;
      case "active_course_blocked":
        ensureBucket(
          category,
          "Unsupported Restore Case",
          [
            "This phase only restores completed treatment history.",
            "Complete or archive active treatment on the source device before exporting a new archive."
          ]
        ).items.push(blocker.message);
        break;
      case "merge_conflict_blocked":
        ensureBucket(
          category,
          "Merge Or Conflict Blocked",
          [
            "This archive needs conflict handling that is not supported in the current phase.",
            "Pick a different archive or wait for a later version with broader merge support."
          ]
        ).items.push(blocker.message);
        break;
    }
  }

  return [...buckets.values()];
}

function CrossLocationSearchResults(props: {
  appClient: AppClient | null;
  search: string;
  currentSection: "active" | "completed" | "archive";
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  archive: ArchiveSnapshot | null;
  onOpenPatient: (patientId: string) => void;
  onRestoreArchivedPatient: (patientId: string) => void;
}) {
  if (!props.search.trim()) {
    return null;
  }

  const activeMatches = props.currentSection === "active" ? [] : buildActiveSearchMatches(props.dashboard, props.search);
  const completedMatches = props.currentSection === "completed" ? [] : buildPatientDetailMatches(props.completed?.patients || [], props.search);
  const archiveMatches = props.currentSection === "archive" ? [] : buildPatientDetailMatches(props.archive?.patients || [], props.search);

  if (!activeMatches.length && !completedMatches.length && !archiveMatches.length) {
    return null;
  }

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h3>Also Found In Other Sections</h3>
          <p>Matching patients from the rest of the app.</p>
        </div>
      </div>
      <div className="patient-list">
        {activeMatches.map((row) => (
          <article className="patient-row-card patient-row-grouped" key={`active-${row.patientId}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={row.patientFacePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{row.patientName}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Active Workflow</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onOpenPatient(row.patientId)}>Open Patient</button>
              </div>
            </div>
          </article>
        ))}
        {completedMatches.map((detail) => (
          <article className="patient-row-card patient-row-grouped" key={`completed-${detail.patient.id}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Completed Patients</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onOpenPatient(detail.patient.id)}>Open Patient</button>
              </div>
            </div>
          </article>
        ))}
        {archiveMatches.map((detail) => (
          <article className="patient-row-card patient-row-grouped" key={`archive-${detail.patient.id}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Archive</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onRestoreArchivedPatient(detail.patient.id)}>Restore</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LockScreen(props: {
  appName: string;
  logoSrc?: string;
  defaultNoteLogoSrc: string;
  requiresPinSetup: boolean;
  statusMessage: string;
  unlockPin: string;
  setupPin: string;
  confirmPin: string;
  setupSettings: AppSettingsView;
  onUnlockPinChange: (value: string) => void;
  onSetupPinChange: (value: string) => void;
  onConfirmPinChange: (value: string) => void;
  onSetupSettingsChange: (settings: AppSettingsView) => void;
  onSetupLogoSelected: (file: File | undefined) => void;
  onRemoveSetupLogo: () => void;
  showSetupInstallPrompt?: boolean;
  showDesktopDownloadPrompt?: boolean;
  desktopDownloadUrl?: string;
  onDismissSetupInstallPrompt?: () => void;
  onUnlock: () => void;
  onSetup: () => void;
  onForgotPin?: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className={`lock-card${props.requiresPinSetup ? " lock-card-setup" : ""}`}>
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>{props.requiresPinSetup ? "Set a local PIN to protect patient notes on this device." : "Unlock with PIN to access patient records."}</p>
        {props.requiresPinSetup ? (
          <div className="settings-grid lock-setup-grid">
            {props.showSetupInstallPrompt ? (
              <div className="panel lock-setup-install-panel">
                <strong>Add to Home Screen First</strong>
                <p>Do this first before setup, or you may need to enter everything again.</p>
                <ol>
                  <li>Tap the Safari Share button, the square with an upward arrow.</li>
                  <li>Tap View More, then scroll down and tap Add to Home Screen.</li>
                  <li>Tap Add.</li>
                </ol>
                <div className="button-row">
                  <span className="install-helper-hint">Safari only. Add it to Home Screen before creating your PIN.</span>
                  <button type="button" className="ghost" onClick={props.onDismissSetupInstallPrompt}>Maybe Later</button>
                </div>
              </div>
            ) : null}
            {props.showDesktopDownloadPrompt && props.desktopDownloadUrl ? (
              <div className="panel lock-setup-download-panel">
                <strong>Use The Desktop Version</strong>
                <p>For Windows computers, download the desktop app before creating a PIN in the browser.</p>
                <div className="button-row">
                  <a className="button primary" href={props.desktopDownloadUrl} target="_blank" rel="noreferrer">
                    Download Desktop Version
                  </a>
                  <span className="install-helper-hint">The desktop app keeps patient records local to that computer.</span>
                </div>
              </div>
            ) : null}
            <div className="panel">
              <label>
                Default Therapist
                <input
                  value={props.setupSettings.defaultTherapist}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, defaultTherapist: event.target.value })}
                />
              </label>
              <label>
                Supervising Physician Name
                <input
                  placeholder="e.g. Avery Bennett, M.D."
                  value={props.setupSettings.supervisingPhysician}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, supervisingPhysician: event.target.value })}
                />
              </label>
              <label>
                Dermatology Office Name
                <input
                  placeholder="e.g. Northfield Skin Clinic"
                  value={props.setupSettings.dermatologyOfficeName}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, dermatologyOfficeName: event.target.value })}
                />
              </label>
              <div className="logo-settings">
                <span className="strong">Dermatology Office Logo</span>
                <img
                  className="settings-logo-preview"
                  src={props.setupSettings.dermatologyOfficeLogoUpload?.dataUrl || props.defaultNoteLogoSrc}
                  alt="Dermatology office logo preview"
                />
                <div className="button-row">
                  <label className="logo-upload-button">
                    Upload Logo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        props.onSetupLogoSelected(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button type="button" onClick={props.onRemoveSetupLogo}>
                    Use Default Logo
                  </button>
                </div>
              </div>
            </div>
            <div className="panel lock-setup-pin-panel">
              <h3>Set PIN</h3>
              <PinInput placeholder="New PIN" value={props.setupPin} onChange={props.onSetupPinChange} />
              <PinInput placeholder="Confirm PIN" value={props.confirmPin} onChange={props.onConfirmPinChange} onDone={props.onSetup} />
              <button className="primary" onClick={props.onSetup}>
                Save Setup
              </button>
            </div>
          </div>
        ) : (
          <>
            <PinInput placeholder="PIN" value={props.unlockPin} onChange={props.onUnlockPinChange} onDone={props.onUnlock} />
            <button className="primary" onClick={props.onUnlock}>
              Unlock
            </button>
            {props.onForgotPin ? (
              <button className="ghost" onClick={props.onForgotPin}>
                Forgot PIN?
              </button>
            ) : null}
          </>
        )}
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
      </div>
    </div>
  );
}

export function InstallPromptBanner(props: {
  onDismiss: () => void;
  setupFirst?: boolean;
}) {
  return (
    <aside className={`install-helper-banner${props.setupFirst ? " install-helper-banner-setup" : ""}`} role="dialog" aria-label="Add to your Home Screen">
      <div className="install-helper-copy">
        <strong>Add to your Home Screen</strong>
        <p>
          {props.setupFirst
            ? "Do this first before setup, or you may need to enter everything again."
            : "For the best iPad experience, install ClearSkin Hub so it opens like a native app."}
        </p>
        <ol>
          <li>Tap the Safari Share button, the square with an upward arrow.</li>
          <li>Tap View More, then scroll down and tap Add to Home Screen.</li>
          <li>Tap Add.</li>
        </ol>
      </div>
      <div className="install-helper-actions">
        <span className="install-helper-hint">
          {props.setupFirst
            ? "Safari only. Add it to Home Screen before creating your PIN."
            : "Safari only. This prompt goes away once dismissed or installed."}
        </span>
        <button className="ghost" onClick={props.onDismiss}>Maybe Later</button>
      </div>
    </aside>
  );
}

export function RecoveryCodeScreen(props: {
  appName: string;
  logoSrc?: string;
  recoveryCode: string;
  onAcknowledge: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>Write down this recovery code and store it somewhere safe. It will not be shown again.</p>
        <div
          style={{
            fontSize: "1.6rem",
            letterSpacing: "0.16rem",
            fontWeight: 700,
            textAlign: "center",
            padding: "0.9rem",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.55)"
          }}
        >
          {props.recoveryCode}
        </div>
        <p className="inline-message">If you forget your PIN and lose this code, the only recovery option will be to wipe all local data on this device.</p>
        <button className="primary" onClick={props.onAcknowledge}>
          I Wrote It Down
        </button>
      </div>
    </div>
  );
}

export function PinRecoveryScreen(props: {
  appName: string;
  logoSrc?: string;
  recoveryCode: string;
  nextPin: string;
  confirmPin: string;
  statusMessage: string;
  showWipeOption: boolean;
  onRecoveryCodeChange: (value: string) => void;
  onNextPinChange: (value: string) => void;
  onConfirmPinChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onWipe: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>Enter your recovery code to set a new PIN for this device.</p>
        <input
          type="text"
          autoCapitalize="characters"
          placeholder="Recovery Code"
          value={props.recoveryCode}
          onChange={(event) => props.onRecoveryCodeChange(event.target.value.toUpperCase())}
        />
        <PinInput placeholder="New PIN" value={props.nextPin} onChange={props.onNextPinChange} />
        <PinInput placeholder="Confirm New PIN" value={props.confirmPin} onChange={props.onConfirmPinChange} onDone={props.onSubmit} />
        <div className="button-row">
          <button className="primary" onClick={props.onSubmit}>
            Reset PIN
          </button>
          <button onClick={props.onCancel}>Back</button>
        </div>
        <button
          className="ghost"
          style={{ fontSize: "0.9rem", padding: "0.25rem 0.5rem", alignSelf: "center" }}
          onClick={props.onWipe}
        >
          Don&apos;t have your recovery code? Wipe local data
        </button>
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
        {props.showWipeOption ? (
          <button className="ghost" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={props.onWipe}>
            Wipe Local Data
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function WipeLocalDataScreen(props: {
  appName: string;
  logoSrc?: string;
  confirmationText: string;
  statusMessage: string;
  onConfirmationTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p style={{ color: "var(--danger)" }}>This will permanently delete all local patient data stored on this device.</p>
        <p className="inline-message">
          This cannot be undone. Any data not previously exported will be lost. Type <strong>WIPE MY DATA</strong> to enable the wipe button.
        </p>
        <input
          type="text"
          placeholder="Type WIPE MY DATA"
          value={props.confirmationText}
          onChange={(event) => props.onConfirmationTextChange(event.target.value)}
        />
        <div className="button-row">
          <button
            className="primary"
            style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
            disabled={props.confirmationText !== "WIPE MY DATA"}
            onClick={props.onConfirm}
          >
            Permanently Wipe Local Data
          </button>
          <button onClick={props.onCancel}>Cancel</button>
        </div>
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
      </div>
    </div>
  );
}


export function DashboardScreen(props: {
  appClient: AppClient | null;
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  archive: ArchiveSnapshot | null;
  search: string;
  onSearchChange: (value: string) => void;
  onAddPatient: () => void;
  onOpenPatient: (patientId: string) => void;
  onArchivePatient: (patientId: string) => void;
  onOpenVisit: (courseId: string, mode: "next_treatment" | "consult_sim", existingVisitId?: string) => void;
  onEditPendingCourse: (patientId: string, courseId: string, mode: "intake" | "full") => void;
  onScheduleCourse: (courseId: string) => void;
  onPrintCourseSchedule: (courseId: string) => void;
  onDeleteCourseSchedule: (courseId: string) => boolean | Promise<boolean>;
  onOpenConsultForms: (patientId: string, courseId: string) => void;
  onGenerateConsentForm: (courseId: string) => void;
  onUploadConsentForm: (patientId: string, courseId: string) => void;
  onOpenConsentForm: (patientId: string, courseId: string) => void;
  onGenerateConsultQuestionnaire: (patientId: string, courseId: string) => void;
  onOpenConsultQuestionnaire: (patientId: string, courseId: string) => void;
  onRestoreArchivedPatient: (patientId: string) => void;
  }) {
  const allCourseRows = props.dashboard?.activeCourses || [];
  const pendingRows = props.dashboard?.pendingCourses || [];
  const noCourseRows = props.dashboard?.patientsWithoutCourse || [];
  const [scheduledCourseIds, setScheduledCourseIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!props.appClient) {
      setScheduledCourseIds(new Set());
      return;
    }
    let cancelled = false;
    const currentYear = new Date().getFullYear();
    void props.appClient.getScheduleSnapshot(`${currentYear - 1}-01-01`, `${currentYear + 2}-12-31`).then((snapshot) => {
      if (cancelled) {
        return;
      }
      setScheduledCourseIds(new Set(snapshot.appointments
        .filter((appointment) => appointment.appointmentType === "treatment" && appointment.status !== "cancelled" && appointment.courseId)
        .map((appointment) => appointment.courseId!)));
    });
    return () => {
      cancelled = true;
    };
  }, [props.appClient, props.dashboard]);

  async function deleteDashboardCourseSchedule(courseId: string) {
    const didDelete = await props.onDeleteCourseSchedule(courseId);
    if (didDelete) {
      setScheduledCourseIds((current) => {
        const next = new Set(current);
        next.delete(courseId);
        return next;
      });
    }
  }

  // Collect unique patients (from courses + no-course rows) in last-name order.
  const patientIds: string[] = [];
  const seen = new Set<string>();
  for (const row of [...allCourseRows, ...noCourseRows].sort(comparePatientRowsByName)) {
    if (!seen.has(row.patientId)) { seen.add(row.patientId); patientIds.push(row.patientId); }
  }

  // Filter by search at the patient level
  const filteredIds = patientIds.filter((id) => {
    const courses = allCourseRows.filter((r) => r.patientId === id);
    const noC = noCourseRows.find((r) => r.patientId === id);
    const ref = courses[0] || noC!;
    return matchesSearch(`${ref.patientName} ${ref.patientMrn} ${courses.map((c) => `${c.courseName} ${c.siteSummary}`).join(" ")}`, props.search);
  });
  const pendingPatientIds = [...new Set([...pendingRows].sort(comparePatientRowsByName).map((row) => row.patientId))].filter((patientId) => {
    const patientRows = pendingRows.filter((row) => row.patientId === patientId);
    const ref = patientRows[0];
    return matchesSearch(
      `${ref.patientName} ${ref.patientMrn} ${patientRows.map((row) => `${row.courseName} ${row.siteSummary}`).join(" ")}`,
      props.search
    );
  });

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Active Patients</h2>
          <p>Current fraction count, suggested note type, and quick actions for today's workflow.</p>
        </div>
        <button className="primary" onClick={props.onAddPatient}>
          Add Patient
        </button>
      </div>
      <input className="search" placeholder="Search patient, MRN, course, or lesion" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="active"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestoreArchivedPatient}
      />
      <div className="patient-list">
        {filteredIds.map((patientId) => {
          const courses = allCourseRows.filter((r) => r.patientId === patientId);
          const noC = noCourseRows.find((r) => r.patientId === patientId);
          const ref = courses[0] || noC!;
          return (
            <article className="patient-row-card patient-row-grouped" key={patientId}>
              <div className="patient-row-grouped-header">
                <PatientAvatar appClient={props.appClient} asset={ref.patientFacePhoto} />
                <div className="patient-row-identity">
                  <div className="patient-row-name">{ref.patientName}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>MRN {ref.patientMrn} · DOB {formatDisplayDate(ref.patientDob)}</div>
                </div>
                <div className="patient-row-actions">
                  <button onClick={() => props.onOpenPatient(patientId)}>Open Patient</button>
                  <button
                    style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                    onClick={() => {
                      if (window.confirm(`Move ${ref.patientName} to Archive? You can restore them later from the Archive screen.`)) {
                        props.onArchivePatient(patientId);
                      }
                    }}
                  >
                    Archive
                  </button>
                </div>
              </div>
              {courses.length === 0 ? (
                <div className="patient-row-course-sub muted">No active treatment course</div>
              ) : courses.map((row) => (
                <div className="patient-row-course-sub" key={row.courseId}>
                  <div className="patient-row-course">
                    <div className="strong" style={{ fontSize: "0.92rem" }}>{row.courseName}</div>
                    {row.siteSummary ? <div className="muted" style={{ fontSize: "0.85rem" }}>{row.siteSummary}</div> : null}
                  </div>
                  <div className="patient-row-stats">
                    {row.prescribedFractions > 0 ? (
                      <>
                        <span>{`Fraction ${row.currentFraction} / ${row.prescribedFractions}`}</span>
                        <span>{row.suggestedNoteType === "consult_sim" ? "Sim / Consult" : row.suggestedNoteType.replace(/_/g, " ")}</span>
                      </>
                    ) : (
                      <span>Sim / Consult</span>
                    )}
                  </div>
                  <div className="patient-row-actions">
                    <button className="primary" onClick={() => props.onOpenVisit(row.courseId, "next_treatment")}>Start Today's Note</button>
                    {row.latestDraftVisitId ? (
                      <button onClick={() => props.onOpenVisit(row.courseId, "next_treatment", row.latestDraftVisitId)}>
                        Resume Last Note
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </div>
      {pendingPatientIds.length ? (
        <>
          <div>
            <h3 style={{ marginBottom: "0.3rem" }}>Pending Sim / Consent</h3>
            <p className="muted" style={{ margin: 0 }}>
              Pathology-driven course intakes waiting for consent generation or full course setup.
            </p>
          </div>
          <div className="patient-list">
            {pendingPatientIds.map((patientId) => {
              const patientRows = pendingRows.filter((row) => row.patientId === patientId);
              const ref = patientRows[0];
              return (
                <article className="patient-row-card patient-row-grouped" key={`pending-${patientId}`}>
                  <div className="patient-row-grouped-header">
                    <PatientAvatar appClient={props.appClient} asset={ref.patientFacePhoto} />
                    <div className="patient-row-identity">
                      <div className="patient-row-name">{ref.patientName}</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        MRN {ref.patientMrn} · DOB {formatDisplayDate(ref.patientDob)}
                      </div>
                    </div>
                    <div className="patient-row-actions">
                      <button onClick={() => props.onOpenPatient(patientId)}>Open Patient</button>
                      <button
                        style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                        onClick={() => {
                          if (window.confirm(`Move ${ref.patientName} to Archive? You can restore them later from the Archive screen.`)) {
                            props.onArchivePatient(patientId);
                          }
                        }}
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                  {patientRows.map((row) => (
                    <div className="patient-row-course-sub" key={row.courseId}>
                      <div className="patient-row-course">
                        <div className="strong" style={{ fontSize: "0.92rem" }}>{row.courseName || "Pending consent course"}</div>
                        {row.siteSummary ? <div className="muted" style={{ fontSize: "0.85rem" }}>{row.siteSummary}</div> : null}
                      </div>
                      <div className="patient-row-stats">
                        <span>Consent / Path Intake</span>
                      </div>
                      <div className="patient-row-actions">
                        <button onClick={() => props.onEditPendingCourse(patientId, row.courseId, "intake")}>Edit Intake</button>
                        <button onClick={() => props.onOpenConsultForms(patientId, row.courseId)}>Consult Forms</button>
                        <CourseScheduleMenu
                          hasSchedule={scheduledCourseIds.has(row.courseId)}
                          onOpenSchedule={() => props.onScheduleCourse(row.courseId)}
                          onPrintSchedule={() => props.onPrintCourseSchedule(row.courseId)}
                          onDeleteSchedule={() => void deleteDashboardCourseSchedule(row.courseId)}
                        />
                        <button className="primary" onClick={() => props.onEditPendingCourse(patientId, row.courseId, "full")}>
                          Complete Course Setup
                        </button>
                      </div>
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function DocumentOnlyScreen(props: {
  snapshot: DocumentOnlySnapshot | null;
  search: string;
  onSearchChange: (value: string) => void;
  onAddRecord: () => void;
  onEditRecord: (recordId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onReviewConsent: (recordId: string) => void;
  onGenerateConsultQuestionnaire: (recordId: string) => void;
  onGenerateSimWorksheet: (recordId: string) => void;
  onOpenConsent: (asset: AssetReference) => void;
  onOpenConsultQuestionnaire: (asset: AssetReference) => void;
  onOpenSimWorksheet: (asset: AssetReference) => void;
}) {
  const records = (props.snapshot?.records ?? []).filter((detail) =>
    matchesSearch(
      `${detail.record.lastName}, ${detail.record.firstName} ${detail.record.mrn} ${detail.sites
        .map((site) => `${site.treatmentLocationText} ${site.diagnosisText}`)
        .join(" ")}`,
      props.search
    )
  );

  return (
    <>
      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Consult Form Generator</h2>
            <p>Generate the consult questionnaire, consent form, and sim worksheet from one patient-info record.</p>
          </div>
          <button className="primary" onClick={props.onAddRecord}>Add Patient Info</button>
        </div>
        <label style={{ display: "block", maxWidth: "360px" }}>
          <input
            placeholder="Search patient, MRN, lesion, or diagnosis"
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
        </label>
      </section>

      {!records.length ? (
        <section className="panel empty-state">
          <h3>No Consult Forms Yet</h3>
          <p>Create a patient-info record to generate consult forms in one place.</p>
        </section>
      ) : (
        <section className="panel">
          <div className="patient-list">
            {records.map((detail) => {
              const consentFile = detail.files.find((file) => file.fileType === "consent_form") ?? null;
              const questionnaireFile = detail.files.find((file) => file.fileType === "consult_questionnaire") ?? null;
              const worksheetFile = detail.files.find((file) => file.fileType === "sim_worksheet") ?? null;
              return (
                <article className="patient-row-card patient-row-grouped" key={detail.record.id}>
                  <div className="patient-row-grouped-header">
                    <div className="patient-row-identity">
                      <div className="patient-row-name">
                        {detail.record.lastName}, {detail.record.firstName}
                      </div>
                      <div className="muted" style={{ fontSize: "0.9rem" }}>
                        MRN {detail.record.mrn} · DOB {formatDisplayDate(detail.record.dob)} ·{" "}
                        {detail.record.courseType === "two_site" ? "2-lesion" : "1-lesion"} document record
                      </div>
                      <div className="muted" style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
                        {detail.sites
                          .map((site) => site.treatmentLocationText || site.bodyLocation || `Lesion ${site.siteNumber}`)
                          .filter(Boolean)
                          .join(" + ")}
                      </div>
                    </div>
                    <div className="patient-row-actions">
                      <button onClick={() => props.onEditRecord(detail.record.id)}>Edit Intake</button>
                      <button
                        style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                        onClick={() => props.onDeleteRecord(detail.record.id)}
                      >
                        Delete Record
                      </button>
                    </div>
                  </div>

                  <div className="patient-row-grouped-course-row">
                    <div>
                      <div className="strong" style={{ fontSize: "0.92rem" }}>Consult Questionnaire</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        {questionnaireFile ? "Questionnaire is saved for this record." : "Ask and save the consult questionnaire around consent time."}
                      </div>
                    </div>
                    <div className="patient-row-actions">
                      <button onClick={() => props.onGenerateConsultQuestionnaire(detail.record.id)}>
                        {questionnaireFile ? "Regenerate Questionnaire" : "Generate Questionnaire"}
                      </button>
                      {questionnaireFile ? (
                        <button onClick={() => props.onOpenConsultQuestionnaire(questionnaireFile.fileAsset)}>Open Questionnaire</button>
                      ) : null}
                    </div>
                  </div>

                  <div className="patient-row-grouped-course-row">
                    <div>
                      <div className="strong" style={{ fontSize: "0.92rem" }}>Consent Form</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        {consentFile ? "Signed consent is saved for this record." : "No consent form generated yet."}
                      </div>
                    </div>
                    <div className="patient-row-actions">
                      <button onClick={() => props.onReviewConsent(detail.record.id)}>
                        {consentFile ? "Re-sign Consent" : "Review / Sign Consent"}
                      </button>
                      {consentFile ? <button onClick={() => props.onOpenConsent(consentFile.fileAsset)}>Open Consent</button> : null}
                    </div>
                  </div>

                  <div className="patient-row-grouped-course-row">
                    <div>
                      <div className="strong" style={{ fontSize: "0.92rem" }}>Sim Worksheet</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        {worksheetFile ? "Sim worksheet is ready for this record." : "Worksheet setup will be collected when you generate it."}
                      </div>
                    </div>
                    <div className="patient-row-actions">
                      <button onClick={() => props.onGenerateSimWorksheet(detail.record.id)}>
                        {worksheetFile ? "Regenerate Sim Worksheet" : "Generate Sim Worksheet"}
                      </button>
                      {worksheetFile ? (
                        <button onClick={() => props.onOpenSimWorksheet(worksheetFile.fileAsset)}>Open Sim Worksheet</button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

export function PatientScreen(props: {
  appClient: AppClient | null;
  patientDetail: PatientDetail;
  onEditPatient: () => void;
  onAddCourse: () => void;
  onEditCourse: (courseId: string) => void;
  onEditPathIntake: (courseId: string) => void;
  onCompleteCourseSetup: (courseId: string) => void;
  onArchivePatient: () => void;
  onOpenVisit: (courseId: string, mode: "next_treatment" | "consult_sim", existingVisitId?: string) => void;
  onScheduleCourse: (courseId: string) => void;
  onPrintCourseSchedule: (courseId: string) => void;
  onDeleteCourseSchedule: (courseId: string) => boolean | Promise<boolean>;
  onCompleteCourse: (courseId: string) => void;
  onRestoreCourse: (courseId: string) => void;
  onOpenPdf: (asset: AssetReference) => void;
  onOpenConsultForms: (patientId: string, courseId: string) => void;
  onGenerateConsentForm: (courseId: string) => void;
  onGenerateConsultQuestionnaire: (patientId: string, courseId: string) => void;
  onUploadConsentForm: (patientId: string, courseId: string) => void;
  onDeleteVisit: (visitId: string) => void;
}) {
  const detail = props.patientDetail;
  const facePhotoSrc = useResolvedAssetUrl(props.appClient, detail.patient.facePhoto);
  const defaultSelectedCourseId = detail.courses.find((courseDetail) => courseDetail.course.status === "active")?.course.id
    ?? detail.courses[0]?.course.id
    ?? "all";
  const [selectedCourseId, setSelectedCourseId] = useState<string>(defaultSelectedCourseId);
  const [scheduledCourseIds, setScheduledCourseIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedCourseId(defaultSelectedCourseId);
  }, [defaultSelectedCourseId]);

  useEffect(() => {
    if (!props.appClient) {
      setScheduledCourseIds(new Set());
      return;
    }
    let cancelled = false;
    const currentYear = new Date().getFullYear();
    void props.appClient.getScheduleSnapshot(`${currentYear - 1}-01-01`, `${currentYear + 2}-12-31`).then((snapshot) => {
      if (cancelled) {
        return;
      }
      setScheduledCourseIds(new Set(snapshot.appointments
        .filter((appointment) => appointment.appointmentType === "treatment" && appointment.status !== "cancelled" && appointment.courseId)
        .map((appointment) => appointment.courseId!)));
    });
    return () => {
      cancelled = true;
    };
  }, [props.appClient, detail.patient.id]);

  async function deleteCourseSchedule(courseId: string) {
    const didDelete = await props.onDeleteCourseSchedule(courseId);
    if (didDelete) {
      setScheduledCourseIds((current) => {
        const next = new Set(current);
        next.delete(courseId);
        return next;
      });
    }
  }

  const visibleCourses = selectedCourseId === "all"
    ? detail.courses
    : detail.courses.filter((cd) => cd.course.id === selectedCourseId);
  const pendingCourses = visibleCourses.filter((courseDetail) => courseDetail.course.status === "pending");
  const regularCourses = visibleCourses.filter((courseDetail) => courseDetail.course.status !== "pending");
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>{patientDisplayName(detail.patient)}</h2>
          <p>MRN {detail.patient.mrn} · DOB {formatDisplayDate(detail.patient.dob)}</p>
        </div>
        <div className="button-row">
          {detail.courses.length > 1 ? (
            <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)} style={{ fontSize: "0.9rem" }}>
              <option value="all">All Courses</option>
              {detail.courses.map((cd) => (
                <option key={cd.course.id} value={cd.course.id}>
                  {cd.course.courseName} ({cd.course.status})
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={props.onEditPatient}>Edit Patient</button>
          <button className="primary" onClick={props.onAddCourse}>Add Course</button>
          <button onClick={props.onArchivePatient}>Archive Patient</button>
        </div>
      </div>
      {detail.patient.facePhoto ? (
        <div className="profile-row">
          {facePhotoSrc ? <img className="face-photo" src={facePhotoSrc} alt="" /> : null}
        </div>
      ) : null}
      {pendingCourses.length ? (
        <>
          <div>
            <h3 style={{ marginBottom: "0.3rem" }}>Pending Sim / Consent</h3>
            <p className="muted" style={{ margin: 0 }}>
              Generate consent from pathology first, then complete the full course setup after the sim / consult.
            </p>
          </div>
          {pendingCourses.map((courseDetail) => {
            return (
              <section className="panel" key={courseDetail.course.id}>
                <div className="section-header">
                  <div>
                    <h3>{courseDetail.course.courseName || "Pending consent course"}</h3>
                    <p>{courseDetail.course.courseType === "one_site" ? "1-lesion course" : "2-lesion course"} · pending</p>
                  </div>
                  <div className="button-row">
                    <button onClick={() => props.onEditCourse(courseDetail.course.id)}>Edit Intake</button>
                    <button onClick={() => props.onOpenConsultForms(courseDetail.course.patientId, courseDetail.course.id)}>
                      Consult Forms
                    </button>
                    <CourseScheduleMenu
                      hasSchedule={scheduledCourseIds.has(courseDetail.course.id)}
                      onOpenSchedule={() => props.onScheduleCourse(courseDetail.course.id)}
                      onPrintSchedule={() => props.onPrintCourseSchedule(courseDetail.course.id)}
                      onDeleteSchedule={() => void deleteCourseSchedule(courseDetail.course.id)}
                    />
                    <button className="primary" onClick={() => props.onCompleteCourseSetup(courseDetail.course.id)}>
                      Complete Course Setup
                    </button>
                  </div>
                </div>
                <div className="site-grid">
                  {courseDetail.sites.map((site) => (
                    <div className="subpanel" key={site.id}>
                      <h4>Lesion {site.siteNumber}</h4>
                      <p>{site.bodyLocation || "Treatment site pending"}</p>
                      <p>{site.diagnosisText || "Diagnosis pending"}</p>
                      <p>{site.icd10 || "ICD10 pending"}</p>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ) : null}
      {regularCourses.map((courseDetail) => (
        (() => {
          const latestDraftVisit = [...courseDetail.visits]
            .filter((visit) => visit.note.status === "draft" && !visit.note.pdfAsset)
            .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0] ?? null;
          const hasGeneratedFinalTreatmentNote = courseDetail.visits.some(
            (visit) => Boolean(visit.note.pdfAsset) && Boolean(visit.note.structuredFields.finalTreatment)
          );
          return (
        <section className="panel" key={courseDetail.course.id}>
          <div className="section-header">
            <div>
              <h3>{courseDetail.course.courseName}</h3>
              <p>{courseDetail.course.prescribedFractions > 0 ? `${courseDetail.course.prescribedFractions} prescribed fractions` : "Sim / Consult"}</p>
              <p>
                {courseDetail.course.courseType === "one_site" ? "1-lesion course" : "2-lesion course"} · {courseDetail.course.status}
              </p>
            </div>
            <div className="button-row course-action-row">
              <button className="documents-button" onClick={() => props.onEditPathIntake(courseDetail.course.id)}>Documents</button>
              <button onClick={() => props.onEditCourse(courseDetail.course.id)}>Edit Course</button>
              {courseDetail.course.status === "active" ? (
                <CourseScheduleMenu
                  hasSchedule={scheduledCourseIds.has(courseDetail.course.id)}
                  onOpenSchedule={() => props.onScheduleCourse(courseDetail.course.id)}
                  onPrintSchedule={() => props.onPrintCourseSchedule(courseDetail.course.id)}
                  onDeleteSchedule={() => void deleteCourseSchedule(courseDetail.course.id)}
                />
              ) : null}
              <button className="primary" onClick={() => props.onOpenVisit(courseDetail.course.id, "next_treatment")}>
                Start Today's Note
              </button>
              {courseDetail.course.status === "active" ? (
                latestDraftVisit ? (
                  <button onClick={() => props.onOpenVisit(courseDetail.course.id, "next_treatment", latestDraftVisit.note.id)}>
                    Resume Last Note
                  </button>
                ) : hasGeneratedFinalTreatmentNote ? (
                  <button onClick={() => props.onCompleteCourse(courseDetail.course.id)}>Treatment Completed</button>
                ) : null
              ) : (
                <button onClick={() => props.onRestoreCourse(courseDetail.course.id)}>Restore Course</button>
              )}
            </div>
          </div>
          <div className="site-grid">
            {courseDetail.sites.map((site) => (
              <div className="subpanel" key={site.id}>
                <h4>Lesion {site.siteNumber}</h4>
                <p>{site.bodyLocation}</p>
                <p>{site.icd10}</p>
                <p>
                  {site.dailyDose > 0 && site.totalDose > 0
                    ? `${site.dailyDose} cGy daily · ${site.totalDose} cGy total`
                    : "Dose set on 1st treatment"}
                </p>
              </div>
            ))}
          </div>
          <div className="visit-list">
            {courseDetail.visits.map((visit) => {
              const latestPdfAsset =
                [...visit.pdfs].sort((left, right) => right.versionNumber - left.versionNumber)[0]?.fileAsset ??
                visit.note.pdfAsset;
              const isFinalizedVisit = visit.note.status === "finalized" && Boolean(latestPdfAsset);
              return (
                <div className="visit-row" key={visit.note.id}>
                <div>
                  <strong>{formatDisplayDate(visit.note.visitDate)}</strong>
                  <span style={{ marginLeft: "0.4rem" }}>{NOTE_TYPE_LABELS[visit.note.noteType]}</span>
                  {visit.note.treatmentNumber ? <span style={{ marginLeft: "0.4rem" }}>{`· Fraction ${visit.note.treatmentNumber}`}</span> : null}
                </div>
                <div className="button-row">
                  {isFinalizedVisit && latestPdfAsset ? (
                    <>
                      <button onClick={() => props.onOpenPdf(latestPdfAsset)}>
                        Open Finalized Note
                      </button>
                      <button
                        onClick={() =>
                          props.onOpenVisit(
                            courseDetail.course.id,
                            visit.note.noteType === "consult_sim" ? "consult_sim" : "next_treatment",
                            visit.note.id
                          )
                        }
                      >
                        Amend
                      </button>
                    </>
                  ) : (
                    <button onClick={() => props.onOpenVisit(courseDetail.course.id, "next_treatment", visit.note.id)}>
                      Open Note
                    </button>
                  )}
                  <button
                    style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                    onClick={() => {
                      if (window.confirm("Delete this note and its attached PDFs/photos? This cannot be undone.")) {
                        props.onDeleteVisit(visit.note.id);
                      }
                    }}
                  >
                    Delete Note
                  </button>
                </div>
                </div>
              );
            })}
          </div>
        </section>
          );
        })()
      ))}
    </section>
  );
}

export function CompletedScreen(props: {
  appClient: AppClient | null;
  completed: ArchiveSnapshot | null;
  dashboard: DashboardSnapshot | null;
  archive: ArchiveSnapshot | null;
  search: string;
  archiveActionBusy: boolean;
  archiveExportBusyPatientId: string | null;
  exportResult: PatientArchiveExportResult | null;
  exportError: string | null;
  preflightResult: PatientArchivePreflightResult | null;
  restoreResult: PatientArchiveRestoreResult | null;
  onSearchChange: (value: string) => void;
  onOpenPatient: (patientId: string) => void;
  onAddCourse: (patientId: string) => void;
  onOpenVisit: (courseId: string, existingVisitId: string) => void;
  onOpenPdf: (asset: AssetReference) => void;
  onExportArchive: (patientId: string) => void;
  onRevealExportPath: (targetPath: string) => void;
  onOpenArchivePath: (targetPath: string) => void;
  onDismissExportResult: () => void;
  onImportArchive: () => void;
  onPickAnotherArchive: () => void;
  onConfirmRestoreArchive: () => void;
  onDismissPreflightResult: () => void;
  onDismissRestoreResult: () => void;
  onRestoreArchivedPatient: (patientId: string) => void;
}) {
  const patients = (props.completed?.patients || []).filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((c) => c.course.courseName).join(" ")}`,
      props.search
    )
  );
  const exportResult = props.exportResult;
  const preflightResult = props.preflightResult;
  const restoreResult = props.restoreResult;
  const blockedSections = preflightResult?.status === "blocked" ? buildBlockedPreflightSections(preflightResult) : [];

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Completed Patients</h2>
          <p>Patients with finished treatment history and no active course. Add a new course to return them to the active workflow.</p>
        </div>
      </div>
      {exportResult || props.exportError ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: exportResult ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{exportResult ? "Archive Exported" : "Archive Export Failed"}</h3>
              <p>
                {exportResult
                  ? "The patient archive was written to local disk using the current desktop export flow. Use the actions on the right to open it or show it in its folder."
                  : "The archive export did not complete. Review the message below and try again."}
              </p>
            </div>
            <div className="button-row">
              {exportResult ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(exportResult.archiveHandle.path)}>Open Archive</button>
                  <button onClick={() => props.onRevealExportPath(exportResult.archiveHandle.path)}>Show In Folder</button>
                </>
              ) : null}
              <button onClick={props.onDismissExportResult}>Dismiss</button>
            </div>
          </div>
          {exportResult ? (
            <>
              <ArchivePathSummary
                fileName={exportResult.archiveHandle.fileName}
                pathLabel="Output path"
                pathValue={exportResult.archiveHandle.path}
              />
              <ArchiveCountSummary
                title="Archive contents"
                lines={[
                  `Bundled asset files: ${exportResult.includedAssetCount}`,
                  `Missing asset files: ${exportResult.missingAssetCount}`,
                  `Archive warnings: ${exportResult.warnings.length}`
                ]}
              />
              {exportResult.warnings.length ? (
                <div>
                  <strong>Export warnings:</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                    {exportResult.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${warning.assetId}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted" style={{ fontSize: "0.9rem" }}>{props.exportError}</div>
          )}
        </section>
      ) : null}
      {preflightResult ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: preflightResult.status === "supported" ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{preflightResult.status === "supported" ? "Archive Ready for Restore" : "Archive Preflight Blocked"}</h3>
              <p>
                {preflightResult.status === "supported"
                  ? "The archive read cleanly and fits the currently supported restore rules. Review the summary below, then choose Restore Archive when you're ready."
                  : "This archive cannot be restored in the current phase. Review the grouped issues below to see what kind of problem occurred and what to do next."}
              </p>
            </div>
            <div className="button-row">
              {preflightResult.status === "supported" ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(preflightResult.sourceArchive.path)}>Open Archive</button>
                  <button className="primary" disabled={props.archiveActionBusy} onClick={props.onConfirmRestoreArchive}>
                    {props.archiveActionBusy ? "Restoring Archive..." : "Restore Archive"}
                  </button>
                </>
              ) : (
                <button className="primary" disabled={props.archiveActionBusy} onClick={props.onPickAnotherArchive}>
                  {props.archiveActionBusy ? "Working..." : "Pick Another Archive"}
                </button>
              )}
              <button onClick={props.onDismissPreflightResult}>{preflightResult.status === "supported" ? "Dismiss" : "Back"}</button>
            </div>
          </div>
          <ArchivePathSummary
            fileName={preflightResult.sourceArchive.fileName}
            pathLabel="Source path"
            pathValue={preflightResult.sourceArchive.path}
          />
          <div className="muted" style={{ fontSize: "0.9rem", marginBottom: "0.8rem" }}>
            {preflightResult.manifest ? (
              <>
                <div>
                  Patient: {preflightResult.manifest.patientIdentity.lastName}, {preflightResult.manifest.patientIdentity.firstName} · MRN {preflightResult.manifest.patientIdentity.mrn} · DOB {formatDisplayDate(preflightResult.manifest.patientIdentity.dob)}
                </div>
                <div>
                  Archive format: {preflightResult.manifest.archiveType} v{preflightResult.manifest.archiveVersion} · prepared {formatDisplayDate(preflightResult.manifest.preparedAt.slice(0, 10))}
                </div>
                <div>
                  Planned action: {formatRestoreModeLabel(preflightResult)}
                </div>
              </>
            ) : (
              <div>The selected ZIP could not be parsed into a valid patient archive manifest.</div>
            )}
          </div>
          {preflightResult.manifest ? (
            <>
              <ArchiveCountSummary
                title="Record counts"
                lines={[
                  `Courses: ${preflightResult.manifest.recordCounts.courses}`,
                  `Sites: ${preflightResult.manifest.recordCounts.sites}`,
                  `Visit notes: ${preflightResult.manifest.recordCounts.visitNotes}`,
                  `Visit photos: ${preflightResult.manifest.recordCounts.visitPhotos}`,
                  `Visit attachments: ${preflightResult.manifest.recordCounts.visitAttachments}`,
                  `Generated PDFs: ${preflightResult.manifest.recordCounts.generatedPdfs}`
                ]}
              />
              <ArchiveCountSummary
                title="Asset counts"
                lines={[
                  `Patient face photos: ${preflightResult.manifest.assetCounts.patient_face_photo}`,
                  `Visit photos: ${preflightResult.manifest.assetCounts.visit_photo}`,
                  `Visit attachments: ${preflightResult.manifest.assetCounts.visit_attachment}`,
                  `Generated PDF files: ${preflightResult.manifest.assetCounts.generated_pdf}`
                ]}
              />
            </>
          ) : null}
          {preflightResult.archiveWarnings.length ? (
            <div style={{ marginBottom: "0.8rem" }}>
              <strong>Archive warnings:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.archiveWarnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.assetId}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preflightResult.status === "blocked" && blockedSections.length ? (
            <div style={{ marginBottom: preflightResult.notices.length ? "0.8rem" : 0 }}>
              {blockedSections.map((section) => (
                <div key={section.title} style={{ marginBottom: "0.8rem" }}>
                  <strong>{section.title}</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.2rem" }}>
                    {section.items.map((item, index) => (
                      <li key={`${section.title}-${index}`}>{item}</li>
                    ))}
                  </ul>
                  <div className="muted" style={{ fontSize: "0.9rem" }}>
                    {section.guidance.join(" ")}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {preflightResult.status === "blocked" && !blockedSections.length && (preflightResult.validationIssues.length || preflightResult.restoreBlockers.length) ? (
            <div style={{ marginBottom: preflightResult.notices.length ? "0.8rem" : 0 }}>
              <strong>Blocked details:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.validationIssues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.entryPath || index}`}>{issue.message}</li>
                ))}
                {preflightResult.restoreBlockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.relatedId || blocker.entryPath || index}`}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preflightResult.notices.length ? (
            <div>
              <strong>{preflightResult.status === "supported" ? "Restore notes:" : "Additional notes:"}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.notices.map((notice, index) => (
                  <li key={`${notice}-${index}`}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {restoreResult ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: restoreResult.status === "restored" ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{restoreResult.status === "restored" ? "Archive Restored" : "Archive Restore Blocked"}</h3>
              <p>
                {restoreResult.status === "restored"
                  ? "The archive was restored into local completed history. Review the summary below, then open the patient record, open the archive ZIP again if needed, or start a new course."
                  : "The archive was not changed locally because the current restore rules could not complete safely."}
              </p>
            </div>
            <div className="button-row">
              {restoreResult.status === "restored" ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(restoreResult.sourceArchive.path)}>Open Archive</button>
                  <button onClick={() => props.onOpenPatient(restoreResult.patientId)}>Open Patient</button>
                  <button className="primary" onClick={() => props.onAddCourse(restoreResult.patientId)}>Start New Course</button>
                </>
              ) : null}
              <button onClick={props.onDismissRestoreResult}>Dismiss</button>
            </div>
          </div>
          <ArchivePathSummary
            fileLabel="Archive source"
            fileName={restoreResult.sourceArchive.fileName}
            pathLabel="Source path"
            pathValue={restoreResult.sourceArchive.path}
          />
          <ArchiveCountSummary
            title="Restore summary"
            lines={[
              `Patient record: ${restoreResult.patientId}`,
              `Courses restored: ${restoreResult.restoredCounts?.courses ?? 0}`,
              `Sites restored: ${restoreResult.restoredCounts?.sites ?? 0}`,
              `Visit notes restored: ${restoreResult.restoredCounts?.visitNotes ?? 0}`,
              `Visit photos restored: ${restoreResult.restoredCounts?.visitPhotos ?? 0}`,
              `Visit attachments restored: ${restoreResult.restoredCounts?.visitAttachments ?? 0}`,
              `Generated PDFs restored: ${restoreResult.restoredCounts?.generatedPdfs ?? 0}`,
              `Asset files restored: ${restoreResult.restoredCounts?.restoredAssets ?? 0}`
            ]}
            marginBottom={restoreResult.blockers.length || restoreResult.notices.length ? "0.8rem" : "0"}
          />
          {restoreResult.restoredCounts ? (
            null
          ) : null}
          {restoreResult.blockers.length ? (
            <div style={{ marginBottom: restoreResult.notices.length ? "0.8rem" : 0 }}>
              <strong>Blocked because:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {restoreResult.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.relatedId || blocker.entryPath || index}`}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {restoreResult.notices.length ? (
            <div>
              <strong>{restoreResult.status === "restored" ? "Restore notes:" : "Details:"}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {restoreResult.notices.map((notice, index) => (
                  <li key={`${notice}-${index}`}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <input className="search" placeholder="Search patient, MRN, or course" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="completed"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestoreArchivedPatient}
      />
      <div className="patient-list">
        {patients.map((detail) => {
          const completedCourses = detail.courses.filter((cd) => cd.course.status === "completed");
          return (
            <article className="patient-row-card patient-row-grouped" key={detail.patient.id}>
              <div className="patient-row-grouped-header">
                <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
                <div className="patient-row-identity">
                  <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>MRN {detail.patient.mrn} · DOB {formatDisplayDate(detail.patient.dob)}</div>
                </div>
                <div className="patient-row-actions">
                  <button onClick={() => props.onOpenPatient(detail.patient.id)}>Open Patient</button>
                  <button onClick={() => props.onExportArchive(detail.patient.id)} disabled={props.archiveExportBusyPatientId === detail.patient.id}>
                    {props.archiveExportBusyPatientId === detail.patient.id ? "Exporting..." : "Export Archive"}
                  </button>
                  <button className="primary" onClick={() => props.onAddCourse(detail.patient.id)}>Add Course</button>
                </div>
              </div>
              {completedCourses.map((courseDetail) => (
                <div className="patient-row-course-sub" key={courseDetail.course.id}>
                  <div className="patient-row-course">
                    <div className="strong" style={{ fontSize: "0.92rem" }}>{courseDetail.course.courseName}</div>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {courseDetail.sites.map((s) => s.bodyLocation).filter(Boolean).join(" + ")}
                      {courseDetail.course.endDate ? ` · completed ${formatDisplayDate(courseDetail.course.endDate)}` : ""}
                    </div>
                  </div>
                  <div className="patient-row-actions">
                    {courseDetail.visits.slice(-1).map((v) => (
                      <button key={v.note.id} onClick={() => props.onOpenVisit(courseDetail.course.id, v.note.id)}>Last Note</button>
                    ))}
                    {courseDetail.visits.slice(-1).flatMap((v) => v.pdfs.slice(-1)).map((pdf) => (
                      <button key={pdf.id} onClick={() => props.onOpenPdf(pdf.fileAsset)}>Open PDF</button>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
        {patients.length === 0 ? <p className="muted">No completed courses yet.</p> : null}
      </div>
    </section>
  );
}

export function ArchiveScreen(props: {
  appClient: AppClient | null;
  archive: ArchiveSnapshot | null;
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  search: string;
  onSearchChange: (value: string) => void;
  onRestore: (patientId: string) => void;
  onPermanentlyDeletePatient: (patientId: string) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const patients = (props.archive?.patients || []).filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((course) => course.course.courseName).join(" ")}`,
      props.search
    )
  );

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Archive</h2>
          <p>Archived patients and their records. Restore to return to the active workflow, or permanently delete to remove all data.</p>
        </div>
      </div>
      <input className="search" placeholder="Search archived patients or courses" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="archive"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestore}
      />
      <div className="patient-list">
        {patients.map((detail) => (
          <article className="panel" key={detail.patient.id} style={{ borderRadius: "10px" }}>
            <div className="section-header">
              <div>
                <strong>{patientDisplayName(detail.patient)}</strong>
                <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.88rem" }}>MRN {detail.patient.mrn} · {detail.patient.status}</span>
              </div>
              <div className="button-row">
                <button onClick={() => props.onRestore(detail.patient.id)}>Restore</button>
                <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => {
                  if (window.confirm(`Permanently delete ${patientDisplayName(detail.patient)} and all their records? This cannot be undone.`)) {
                    props.onPermanentlyDeletePatient(detail.patient.id);
                  }
                }}>Permanently Delete</button>
              </div>
            </div>
            {detail.courses.map((courseDetail) => (
              <div className="visit-row" key={courseDetail.course.id}>
                <div>
                  <strong>{courseDetail.course.courseName}</strong>
                  <span className="muted" style={{ marginLeft: "0.6rem", fontSize: "0.85rem" }}>{courseDetail.course.status}</span>
                </div>
              </div>
            ))}
          </article>
        ))}
        {patients.length === 0 ? <p className="muted">No archived patients.</p> : null}
      </div>
    </section>
  );
}

export function SettingsScreen(props: {
  appClient: AppClient | null;
  settingsPayload: SettingsPayload;
  defaultLogoSrc: string;
  changePin: { currentPin: string; nextPin: string; confirmPin: string };
  onSettingsChange: (settings: SettingsPayload["settings"]) => void;
  onChangePin: (next: { currentPin: string; nextPin: string; confirmPin: string }) => void;
  onSave: () => void;
  onSubmitPin: () => void;
  onLockApp: () => void;
  onLogoSelected: (file: File | undefined) => void;
  onRemoveLogo: () => void;
  onRememberPhysician: () => void;
  onDeleteSavedOption: (optionId: string) => void;
}) {
  const resolvedLogoSrc = useResolvedAssetUrl(props.appClient, props.settingsPayload.settings.dermatologyOfficeLogoAsset);
  const currentLogoSrc = props.settingsPayload.settings.dermatologyOfficeLogoUpload?.dataUrl
    || resolvedLogoSrc
    || props.defaultLogoSrc;
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheckResult | null>(null);
  const savedPhysicians = props.settingsPayload.savedOptions.filter((option) => option.type === "physician");

  async function checkForUpdates() {
    if (!props.appClient) {
      return;
    }

    setUpdateBusy(true);
    try {
      setUpdateCheck(await props.appClient.checkForUpdates());
    } catch {
      setUpdateCheck({
        runtime: "browser",
        status: "unavailable",
        action: "none",
        currentVersionLabel: "",
        latestVersionLabel: null,
        message: "Could not check for updates. Try again when the network is available.",
        checkedAt: new Date().toISOString()
      });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function runUpdateAction() {
    if (!props.appClient || !updateCheck || updateCheck.action === "none") {
      return;
    }

    if (updateCheck.action === "refresh") {
      window.location.reload();
      return;
    }

    await props.appClient.openUpdateDownload();
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Settings</h2>
          <p>Branding, note defaults, and PIN maintenance.</p>
        </div>
        <button className="primary" onClick={props.onSave}>
          Save Settings
        </button>
      </div>
      <div className="settings-grid">
        <div className="panel">
          <label>
            Default Therapist
            <input value={props.settingsPayload.settings.defaultTherapist} onChange={(event) => props.onSettingsChange({ ...props.settingsPayload.settings, defaultTherapist: event.target.value })} />
          </label>
          <label>
            Supervising Physician Name
            <div className="inline-add-field">
              <input
                placeholder="e.g. Avery Bennett, M.D."
                value={props.settingsPayload.settings.supervisingPhysician}
                onChange={(event) =>
                  props.onSettingsChange({
                    ...props.settingsPayload.settings,
                    supervisingPhysician: event.target.value
                  })
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Add supervising physician to list"
                onClick={props.onRememberPhysician}
              >
                +
              </button>
            </div>
          </label>
          <div className="saved-option-list">
            <span className="strong">Physician List</span>
            {savedPhysicians.length ? (
              savedPhysicians.map((option) => (
                <div className="saved-option-row" key={option.id}>
                  <span>{option.value}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${option.value}`}
                    onClick={() => props.onDeleteSavedOption(option.id)}
                  >
                    X
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">No saved physicians yet.</p>
            )}
          </div>
          <label>
            Dermatology Office Name
            <input placeholder="e.g. Northfield Skin Clinic" value={props.settingsPayload.settings.dermatologyOfficeName} onChange={(event) => props.onSettingsChange({ ...props.settingsPayload.settings, dermatologyOfficeName: event.target.value })} />
          </label>
          <div className="logo-settings">
            <span className="strong">Dermatology Office Logo</span>
            <img className="settings-logo-preview" src={currentLogoSrc} alt="Dermatology office logo preview" />
            <div className="button-row">
              <label className="logo-upload-button">
                Upload Logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    props.onLogoSelected(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button onClick={props.onRemoveLogo}>Use Default Logo</button>
            </div>
          </div>
        </div>
        <div className="panel">
          <h3>Change PIN</h3>
          <PinInput placeholder="Current PIN" value={props.changePin.currentPin} onChange={(next) => props.onChangePin({ ...props.changePin, currentPin: next })} />
          <PinInput placeholder="New PIN" value={props.changePin.nextPin} onChange={(next) => props.onChangePin({ ...props.changePin, nextPin: next })} />
          <PinInput placeholder="Confirm New PIN" value={props.changePin.confirmPin} onChange={(next) => props.onChangePin({ ...props.changePin, confirmPin: next })} onDone={props.onSubmitPin} />
          <button onClick={props.onSubmitPin}>Update PIN</button>
          <button className="ghost" onClick={props.onLockApp}>Lock App</button>
        </div>
        <div className="panel">
          <h3>Updates</h3>
          <div className="button-row">
            <button onClick={() => void checkForUpdates()} disabled={updateBusy || !props.appClient}>
              {updateBusy ? "Checking..." : "Check for Updates"}
            </button>
            {updateCheck && updateCheck.action !== "none" ? (
              <button className="primary" onClick={() => void runUpdateAction()}>
                {updateCheck.action === "refresh" ? "Refresh Now" : "Download Installer"}
              </button>
            ) : null}
          </div>
          {updateCheck ? (
            <p className={updateCheck.status === "available" ? "update-status available" : "update-status"}>
              {updateCheck.message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function TemplatesScreen(props: {
  templates: TemplateDefinitionRecord[];
  selectedTemplateId: string;
  templateDraft: string;
  onSelectTemplate: (template: TemplateDefinitionRecord) => void;
  onTemplateDraftChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Template Manager</h2>
          <p>Edit wording safely while keeping supported placeholders visible for each note family.</p>
        </div>
        <div className="button-row">
          <button onClick={props.onReset}>Reset to Default</button>
          <button className="primary" onClick={props.onSave}>
            Save Template
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="panel template-list">
          {props.templates.map((template) => (
            <button key={template.id} className={template.id === props.selectedTemplateId ? "nav active" : "nav"} onClick={() => props.onSelectTemplate(template)}>
              {template.key}
            </button>
          ))}
        </div>
        <div className="panel note-panel">
          <textarea className="template-textarea" value={props.templateDraft} onChange={(event) => props.onTemplateDraftChange(event.target.value)} />
        </div>
        <div className="panel template-side">
          <h3>Available Placeholders</h3>
          <div className="placeholder-list">
            {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
              <div key={placeholder.token} className="placeholder">
                <strong>{`{{${placeholder.token}}}`}</strong>
                <span>{placeholder.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

