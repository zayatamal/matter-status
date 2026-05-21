# MatterStatus

Automatically sync your Mattermost custom status with your Google Calendar. MatterStatus watches your calendar and updates your status in real-time based on events.

## Getting Started

### Install

1. Clone this repository:

   ```bash
   git clone https://github.com/f-atwi/matter-status.git
   cd matter-status
   ```

2. Install npm if you haven't already.

    ```bash
    # For Debian/Ubuntu
    sudo apt update
    sudo apt install npm
    ```

3. Install clasp (Google Apps Script CLI):

   ```bash
   sudo npm install -g @google/clasp
   ```

4. Authenticate with Google:

   ```bash
   clasp login
   ```

    Follow the prompts to authorize clasp with your Google account.

5. Link to your Google Apps Script project:

   **First time:** create a new Apps Script project:

   ```bash
   clasp create --type webapp
   ```

   **Re-cloning** (you already have an Apps Script project): find your script ID with `clasp list`, then clone it:

   ```bash
   clasp clone <scriptId>
   ```

### Configure

1. Copy the sample config:

   ```bash
   cp config.js.sample config.js
   ```

2. Edit `config.js` with your settings:

   ```javascript
   const USER_CONFIG = {
     WORK_START_HOUR: 8,           // Ignore events before this hour
     WORK_END_HOUR: 18,            // Ignore events after this hour
     MATTERMOST_URL: "https://your-instance.com",
     MATTERMOST_TOKEN: "your-token-here",
   };
   ```

   Need your Mattermost token? See [Find Your Mattermost Token](#find-your-mattermost-token).

3. Push to Google Apps Script:

   ```bash
   clasp push
   ```

### Initial Setup

Set up automatic triggers (run once):

1. Open the script in your browser:

   ```bash
   clasp open
   ```

2. Select `setupRecurringTriggers` from the function dropdown and click **Run**

3. Authorize the script when prompted

Done! The script will now run automatically.

**Next step:** Create your first status event. See [Create a Status Event](#create-a-status-event).

## How-to Guides

### Create a Status Event

Add a calendar event with a custom status:

1. Create a new event in Google Calendar
2. In the description, add:

   ```json
   custom_status
   {
     "emoji": "laptop",
     "text": "In a meeting"
   }
   ```

    !! Note: The `custom_status` marker is required.
    Events without it will be ignored.
3. Save the event

For all-day events, the status is set in the morning (midnight trigger) or when a calendar change is detected, with the expiry set to the event's end date (which may span multiple days). For timed events (used only when no all-day status event exists), the status is set when the event starts and clears when it ends.

See [Event Description Format](#event-description-format) for the exact format and available emoji options in [Available Emojis](#available-emojis).

### Find Your Mattermost Token

1. Go to Mattermost
2. Click your profile → Account Settings
3. Select "Personal Access Tokens"
4. Click "Create New Token"
5. Copy the token and paste it in `config.js`

### Change Working Hours

Edit `config.js` to adjust when status updates are active:

```javascript
WORK_START_HOUR: 9,    // Status updates start at 9 AM
WORK_END_HOUR: 17,     // Status updates stop at 5 PM
```

Status updates outside these hours are ignored. See [Configuration](#configuration) for details.

## Troubleshooting

**Status not updating?**

- Check that `custom_status` is in the event description
- Verify working hours include the event time
- Open `clasp open` and check the logs

## Reference

### Available Emojis

[Emoji names can be found here](https://www.webfx.com/tools/emoji-cheat-sheet/).

Custom mattermost emojis can also be used.

### Event Description Format

```json
custom_status
{
  "emoji": "emoji_name",
  "text": "Your status text"
}
```

- `custom_status` marker is required (case-insensitive)
- Both `emoji` and `text` fields are required
- Events without this marker are ignored

### Configuration

| Setting | Type | Description |
| ------- | ---- | ----------- |
| `WORK_START_HOUR` | number | Hour (0-23) when status updates begin |
| `WORK_END_HOUR` | number | Hour (0-23) when status updates stop |
| `MATTERMOST_URL` | string | Your Mattermost instance URL |
| `MATTERMOST_TOKEN` | string | Personal access token (keep secret!) |

Working hours are only used for reducing the number of API calls outside business hours.
Any calendar events outside these hours are ignored.
Though we cannot have a conditional trigger based on time,
the handler function returns early if the current time is outside working hours.

## Explanation

### Architecture

```mermaid
flowchart TD
    subgraph TRIGGERS["What triggers the script"]
        A([Every day at midnight])
        C([Calendar change event])
        ST([Scheduled trigger fires at event start])
    end

    subgraph CHANGE["On calendar change"]
        D{Working hours?}
        F{Active status event?}
        G{Script set the status?}
        H{User changed it manually?}
        CLR[Clear the Mattermost status]
        D -->|No| STOP([Stop])
        D -->|Yes| F
        F -->|No| G
        G -->|Yes| H
        H -->|No| CLR
    end

    subgraph SCAN["Scan today's events"]
        AD{All-day event with custom_status marker?}
        AD -->|No| K
        K{For each timed event: has custom_status marker?}
        M{Already ended?}
        N{Already started?}
        P[Schedule trigger for event start]
        NEXT{More events?}
        K -->|No| NEXT
        K -->|Yes| M
        M -->|Yes| NEXT
        M -->|Not yet| N
        N -->|No — future event| P --> NEXT
        NEXT -->|Yes, next event| K
        NEXT -->|No| Z([Done])
    end

    subgraph UPDATE["Set the Mattermost status"]
        Q{Manual status active?}
        Q -->|Yes| SKIP([Skip — do not overwrite])
        Q -->|No| S[Set status to event's emoji, text and end time]
        S --> T[Remember status was set by script]
        T --> Z2([Done])
    end
    AD -->|Yes — use first match| Q
    N -->|Yes — in progress| Q
    A --> AD
    C --> D
    F -->|Yes| AD
    G -->|No| AD
    H -->|Yes| AD
    CLR --> AD
    ST --> Q
```

1. **Morning trigger** (daily at 00:00): Scans today's events. All-day events with a status marker take priority and are set directly. If none exist, triggers are scheduled for upcoming timed events with status markers.
2. **Calendar trigger** (on event updates): Immediately checks for status changes and sets or clears the status accordingly
3. **Status update**: All-day status events take priority over timed events. The status expiry is set to the event's end time (all-day events may span multiple days)
4. **Status clear**: When no status event is active and the status was set by this script, it is cleared automatically

## Known Limitations

- **All-day events take priority**: If an all-day event with a status marker exists on a given day, timed events are ignored for that day.
- **Single calendar**: Only the user's primary calendar is monitored. Multiple calendars are not supported.
- **No overlapping events**: If multiple events with status markers overlap (all-day or timed), the first one returned by the Calendar API is used. The order is not guaranteed.
- **Status clearing behavior**: When calendar events are updated or deleted, the script clears any active status if no event is currently active and the status was set by this script. Custom statuses set outside of this script are preserved.
- **Manual status takes priority**: If you set a custom status manually (e.g. an out-of-office status), the script will not overwrite or clear it. Calendar-based updates resume only once the manual status expires or is removed.
