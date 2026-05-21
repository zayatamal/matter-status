/***********************
 INTERNAL CONSTANTS
************************/
const TRIGGER_HANDLER = "updateMattermostStatusFromCurrentEvent";
const CUSTOM_STATUS_MARKER = "custom_status";
const MATTERMOST_USER_ID_CACHE_KEY = "MATTERMOST_USER_ID";
const CALENDAR_EVENT_SEARCH_WINDOW_MS = 1000;
const MORNING_TRIGGER_START_HOUR = 0;
const MORNING_TRIGGER_START_MINUTE = 0;

/***********************
 TRIGGER HANDLERS
************************/
function onCalendarChange() {
  const now = new Date();
  const hours = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday

  // Skip night hours
  if (hours < WORK_START_HOUR || hours > WORK_END_HOUR) return;
  if (day === 0 || day === 6) return; // skip weekends

  if (!getCurrentStatusEvent()) clearMattermostCustomStatus();
  planEventStatusTriggers();
}

function onMorningTrigger() {
  planEventStatusTriggers();
}

/***********************
 TRIGGER MANAGEMENT
************************/
function planEventStatusTriggers() {
  const now = new Date();

  const calendar = CalendarApp.getDefaultCalendar();
  const events = calendar.getEventsForDay(now);
  clearEventStatusTriggers();

  for (const event of events) {
    if (event.isAllDayEvent()) continue;
    if (hasStatusMarker(event.getDescription())) {
      const start = event.getStartTime();
      const end = event.getEndTime();
      // Event already finished
      if (end <= now) continue;

      if (start <= now) {
        Logger.log("Setting status for " + event.getTitle());
        updateMattermostStatusFromCurrentEvent();
        continue;
      }

      createEventStartTrigger(event.getTitle(), start);
    }
  }
}

function clearEventStatusTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });
  if (deletedCount > 0) {
    Logger.log(`Cleared ${deletedCount} existing event status trigger(s)`);
  }
}

function createEventStartTrigger(key, startTime) {
  const trigger = ScriptApp.newTrigger(TRIGGER_HANDLER)
    .timeBased()
    .at(startTime)
    .create();
  Logger.log(`Scheduled trigger for "${key}" at ${startTime.toLocaleString()}`);
}

/***********************
 EVENT STATUS
************************/
function getCurrentStatusEvent() {
  const now = new Date();
  const events = CalendarApp.getDefaultCalendar().getEvents(
    now,
    new Date(now.getTime() + CALENDAR_EVENT_SEARCH_WINDOW_MS)
  );
  for (const event of events) {
    if (hasStatusMarker(event.getDescription())) return event;
  }
  return null;
}

function extractStatusFromEvent(event) {
  const eventData = parseStatusFromEventDescription(event.getDescription());
  return {
    emoji: eventData.emoji,
    text: eventData.text,
    expiresAt: event.getEndTime(),
  };
}

/***********************
 MATTERMOST API
************************/
function getMattermostUserId() {
  const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  savedId = SCRIPT_PROPERTIES.getProperty(MATTERMOST_USER_ID_CACHE_KEY);
  if (savedId) {
    return savedId;
  }
  const url = `${MATTERMOST_URL}/api/v4/users/me`; // API endpoint to get current user info

  const options = {
    method: "get",
    headers: {
      Authorization: `Bearer ${MATTERMOST_TOKEN}`,
      "Content-Type": "application/json",
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      const data = JSON.parse(body);
      const userId = data.id;
      SCRIPT_PROPERTIES.setProperty(MATTERMOST_USER_ID_CACHE_KEY, userId);
      Logger.log(`User ID cached: ${userId}`);
      return userId;
    } else {
      Logger.log(`Failed to fetch user ID (code: ${code})`);
      throw new Error(`Mattermost API error: ${code}`);
    }
  } catch (err) {
    Logger.log(`Error fetching Mattermost user ID: ${err}`);
  }
}

function updateMattermostStatusFromEvent(event) {
  const statusData = extractStatusFromEvent(event);
  updateMattermostStatus(statusData);
}

function updateMattermostStatusFromCurrentEvent() {
  const event = getCurrentStatusEvent();
  if (!event) throw new Error("No matching event found");

  updateMattermostStatusFromEvent(event);
}

function updateMattermostStatus(statusData) {
  const userId = getMattermostUserId();
  const url = `${MATTERMOST_URL}/api/v4/users/${userId}/status/custom`;

  const payload = {
    emoji: statusData.emoji,
    text: statusData.text,
    expires_at: statusData.expiresAt,
  };

  const options = {
    method: "put",
    headers: {
      Authorization: `Bearer ${MATTERMOST_TOKEN}`,
      "Content-Type": "application/json",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code === 200) {
    Logger.log(`Status updated: ${statusData.text} ${statusData.emoji}`);
  } else {
    Logger.log(
      `Failed to update status (code: ${code}): ${response.getContentText()}`
    );
  }
}

function clearMattermostCustomStatus() {
  const userId = getMattermostUserId();
  const url = `${MATTERMOST_URL}/api/v4/users/${userId}/status/custom`;

  const options = {
    method: "delete",
    headers: {
      Authorization: `Bearer ${MATTERMOST_TOKEN}`,
      Accept: "application/json",
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      Logger.log("Custom status cleared");
    } else {
      Logger.log(`Failed to clear status (code: ${code})`);
    }
  } catch (err) {
    Logger.log(`Error clearing custom status: ${err}`);
  }
}

function getMattermostCustomStatus() {
  const url = `${MATTERMOST_URL}/api/v4/users/me`; // API endpoint to get current user info

  const options = {
    method: "get",
    headers: {
      Authorization: `Bearer ${MATTERMOST_TOKEN}`,
      "Content-Type": "application/json",
    },
    muteHttpExceptions: true,
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code === 200) {
      const data = JSON.parse(body);
      const customStatus = data.props.customStatus;
      Logger.log(`Current custom status: ${customStatus}`);
      return customStatus;
    } else {
      Logger.log(`Failed to fetch custom status (code: ${code})`);
    }
  } catch (err) {
    Logger.log(`Error fetching custom status: ${err}`);
  }
}

/***********************
 UTILITIES
************************/
function sanitizeDescription(text) {
  return text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\x20-\x7E]/g, "");
}

function hasStatusMarker(description) {
  return sanitizeDescription(description)
    .trimStart()
    .toLowerCase()
    .startsWith(CUSTOM_STATUS_MARKER);
}

function parseStatusFromEventDescription(description) {
  let jsonText = sanitizeDescription(description)
    .trimStart()
    .slice(CUSTOM_STATUS_MARKER.length)
    .trim();

  // Decode HTML entities
  jsonText = decodeHtmlEntities(jsonText);

  // Strip any extra prose and smart quotes before JSON parsing
  jsonText = extractJsonObject(jsonText);

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`custom_status JSON is invalid: ${err.message}`);
  }

  if (
    !data ||
    typeof data.emoji !== "string" ||
    typeof data.text !== "string"
  ) {
    throw new Error(
      "custom_status JSON is invalid: must have string 'emoji' and 'text'"
    );
  }

  return {
    emoji: data.emoji,
    text: data.text,
  };
}

function decodeHtmlEntities(text) {
  const map = {
    "&quot;": '"',
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&#39;": "'",
  };
  return text.replace(/&quot;|&amp;|&lt;|&gt;|&#39;/g, (match) => map[match]);
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || start > end) {
    throw new Error("custom_status JSON is invalid: missing '{' or '}'");
  }

  return text.slice(start, end + 1).trim();
}

/*****************************
 SETUP & UTILITIES
******************************/
function setupRecurringTriggers() {
  const MORNING_HANDLER = "onMorningTrigger"; // function to run
  const ON_CALENDAR_CHANGE_HANDLER = "onCalendarChange"; // function to run

  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`Clearing ${triggers.length} existing trigger(s)`);
  for (const t of triggers) {
    ScriptApp.deleteTrigger(t);
  }

  // Apps Script Weekday enums
  const weekdays = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.TUESDAY,
    ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.THURSDAY,
    ScriptApp.WeekDay.FRIDAY,
  ];

  // Create new weekly triggers
  for (const day of weekdays) {
    ScriptApp.newTrigger(MORNING_HANDLER)
      .timeBased()
      .onWeekDay(day)
      .atHour(MORNING_TRIGGER_START_HOUR)
      .nearMinute(TRIGGER_START_MINUTE)
      .create();
  }

  ScriptApp.newTrigger(ON_CALENDAR_CHANGE_HANDLER)
    .forUserCalendar(CalendarApp.getDefaultCalendar().getName())
    .onEventUpdated()
    .create();

  Logger.log(
    `Triggers configured: daily at ${MORNING_TRIGGER_START_HOUR}:${String(
      TRIGGER_START_MINUTE
    ).padStart(2, "0")} + on calendar changes`
  );
}
