let device = null;
let deviceIndex = null;
let deviceSettings = null;

// Cached DOM elements
let elemWheel, elemThrottle, elemBrake, elemClutch;
let buttonElements = []; // cached <div id="button-i"> elements
let lastInputSend = 0;
const sendIntervalMs = 80;

function safeValue(value) {
  return value ? value : null;
}

function bindHtml(type, index, val1, val2) {
  if (type === "control") {
    return `
      <div><b>Button #${index}</b></div>
      <div>
        <select id="button-select-${index}">
          <option value="control" selected>Control Pad</option>
          <option value="command">Command</option>
        </select>
        <input id="button-input-${index}-0" type="number" min="0" placeholder="Control Type" ${val1 !== undefined ? `value="${val1}"` : ""}>
        <input id="button-input-${index}-1" type="number" min="0" placeholder="Control Index" ${val2 !== undefined ? `value="${val2}"` : ""}>
      </div>`;
  } else {
    return `
      <div><b>Button #${index}</b></div>
      <div>
        <select id="button-select-${index}">
          <option value="control">Control Pad</option>
          <option value="command" selected>Command</option>
        </select>
        <input id="button-input-${index}-0" type="text" placeholder="Pressed" ${val1 !== undefined ? `value="${val1}"` : ""}>
        <input id="button-input-${index}-1" type="text" placeholder="Released" ${val2 !== undefined ? `value="${val2}"` : ""}>
      </div>`;
  }
}

// updateSettings unchanged logic-wise but simpler flow
function updateSettings(data = {inputs:{}, binds:{}}, forceUpdate) {
  if (!forceUpdate) {
    deviceSettings = {
      deviceIndex: data.inputs[0] || "null",
      wheelDeadzone: data.inputs[1] || 0.25,
      wheelRadius: data.inputs[2] || 900,
      wheelIndex: data.inputs[3] || 0,
      throttleIndex: data.inputs[4] || 1,
      brakeIndex: data.inputs[5] || 2,
      binds: data.binds || {}
    };
    // send settings to backend (non-blocking)
    fetch('https://pickle_wheel/updateSettings', {
      method: 'post',
      headers: {'Accept':'application/json','Content-Type':'application/json'},
      body: JSON.stringify(deviceSettings)
    }).catch(()=>{});
  } else {
    deviceSettings = data;
    if (deviceIndex !== deviceSettings.deviceIndex) {
      deviceIndex = deviceSettings.deviceIndex;
      if (deviceIndex !== "null") {
        initApp(deviceIndex);
      }
    }
  }
}

// Build the device select options (small helper)
function buildDeviceOptions() {
  const gps = navigator.getGamepads();
  const opts = ['<option value="null">Select Device</option>'];
  for (let gp of gps) {
    if (!gp) continue;
    const selected = (gp.index == deviceIndex) ? ' selected' : '';
    opts.push(`<option value="${gp.index}"${selected}>${gp.id}</option>`);
  }
  return opts.join('');
}

function cacheUiAfterInit(device) {
  // cache UI nodes used every frame
  elemWheel    = document.getElementById('wheel');
  elemThrottle = document.querySelector('#throttle > span');
  elemBrake    = document.querySelector('#brake > span');
  elemClutch   = document.querySelector('#clutch > span');

  // cache button container elements
  buttonElements = [];
  for (let i = 0; i < device.buttons.length; i++) {
    const el = document.getElementById(`button-${i}`);
    if (el) buttonElements[i] = el;
    else buttonElements[i] = null;
  }
}

function initApp(index) {
  deviceIndex = index;
  const gps = navigator.getGamepads();
  const gp = gps[index];
  if (!gp || !deviceSettings) {
    deviceIndex = null;
    const html = `
      <h3>Device</h3>
      <div class="option">
        <div><b>Select Device</b></div>
        <div><select id="input-0">${buildDeviceOptions()}</select></div>
      </div>`;
    $(".middle").html(html);
    return;
  }

  let html = `
    <h3>Device</h3>
    <div class="option">
      <div><b>Select Device</b></div>
      <div><select id="input-0">${buildDeviceOptions()}</select></div>
    </div>
    <div class="option"><div><b>Wheel Deadzone</b></div><div><input id="input-1" type="number" step="0.01" value="${deviceSettings.wheelDeadzone}" min="0.0" max="1.0"></div></div>
    <div class="option"><div><b>Wheel Radius</b></div><div><input id="input-2" type="number" step="1" value="${deviceSettings.wheelRadius}" min="0" max="1800"></div></div>
    <div class="option"><div><b>Wheel Input Index</b></div><div><input id="input-3" type="number" value="${deviceSettings.wheelIndex}"></div></div>
    <div class="option"><div><b>Throttle Input Index</b></div><div><input id="input-4" type="number" value="${deviceSettings.throttleIndex}"></div></div>
    <div class="option"><div><b>Brake Input Index</b></div><div><input id="input-5" type="number" value="${deviceSettings.brakeIndex}"></div></div>
    <h3>Binding</h3>`;

  for (let i = 0; i < gp.buttons.length; i++) {
    const bind = (deviceSettings.binds && deviceSettings.binds[i] && deviceSettings.binds[i].type)
      ? bindHtml(deviceSettings.binds[i].type, i, deviceSettings.binds[i].values[0], deviceSettings.binds[i].values[1])
      : bindHtml("control", i);
    html += `<div class="option" id="button-${i}">${bind}</div>`;
  }

  $(".middle").html(html);

  cacheUiAfterInit(gp);

  lastInputSend = 0;
  gameLoop(deviceIndex);
}

function sendInputUpdate(payload) {
  // simple rate-limited sender
  fetch('https://pickle_wheel/updateInput', {
    method: 'post',
    headers: {'Accept':'application/json','Content-Type':'application/json'},
    body: JSON.stringify(payload)
  }).catch(()=>{});
}

// main loop: update visuals every frame, send network updates at limited rate
function gameLoop(index) {
  // quick retrieval by index (avoid iterating all gamepads)
  const gp = navigator.getGamepads()[index];
  if (!gp || index !== deviceIndex) {
    // device disappeared; bail out
    return;
  }
  device = gp;

  // read axes using the configured indexes
  const rawWheel    = device.axes[deviceSettings.wheelIndex];
  const rawThrottle = device.axes[deviceSettings.throttleIndex];
  const rawBrake    = device.axes[deviceSettings.brakeIndex];

  // compute the displayed values (visuals)
  const wheelDeg = Math.round((deviceSettings.wheelRadius / 2) * rawWheel * 1000) / 1000;
  const throttleAxis = (rawThrottle * -1 + 1) / 2;
  const brakeAxis    = (rawBrake * -1 + 1) / 2;

  if (elemWheel)    elemWheel.style.transform = `rotate(${wheelDeg}deg)`;
  if (elemThrottle) elemThrottle.style.height = `${100 - throttleAxis*100}%`;
  if (elemBrake)    elemBrake.style.height    = `${100 - brakeAxis*100}%`;

  // send network update at most every sendIntervalMs
  const now = performance.now();
  if (now - lastInputSend >= sendIntervalMs) {
    lastInputSend = now;
    // send normalized raw values
    sendInputUpdate({
      wheelAxis: rawWheel,
      throttleAxis: (rawThrottle * -1) + 1,
      brakeAxis: (rawBrake * -1) + 1
    });
  }

  // buttons: only manipulate cached DOM nodes, and only when state changes
  for (let i = 0; i < device.buttons.length; i++) {
    const pressed = device.buttons[i].pressed;
    const btnEl = buttonElements[i];
    if (!btnEl) continue;
    const isPressedClass = btnEl.classList.contains('pressed');

    if (pressed && !isPressedClass) {
      btnEl.classList.add('pressed');
      fetch('https://pickle_wheel/buttonUpdate', {
        method: 'post',
        headers: {'Accept':'application/json','Content-Type':'application/json'},
        body: JSON.stringify({index: i, pressed: true})
      }).catch(()=>{});
    } else if (!pressed && isPressedClass) {
      btnEl.classList.remove('pressed');
      fetch('https://pickle_wheel/buttonUpdate', {
        method: 'post',
        headers: {'Accept':'application/json','Content-Type':'application/json'},
        body: JSON.stringify({index: i, pressed: false})
      }).catch(()=>{});
    }
  }

  // next frame
  requestAnimationFrame(() => gameLoop(index));
}

$(document).ready(function() {
  const html = `
  <h3>Device</h3>
  <div class="option">
    <div><b>Select Device</b></div>
    <div><select id="input-0">${buildDeviceOptions()}</select></div>
  </div>`;
  $(".middle").html(html);

  $(document).on("change", "select", function () {
    const parentId = $(this).closest('.option').attr('id');
    if (parentId && parentId.includes("button-")) {
      const index = parentId.replace("button-", "");
      const bind = bindHtml($(this).val(), index);
      $("#" + parentId).html(bind);
      return;
    }
    const id = $(this).attr("id");
    if (id === "input-0") {
      const val = $(this).val();
      if (val !== "null") {
        initApp(val);
      } else {
        deviceIndex = null;
        $(".middle").html(`
          <h3>Device</h3>
          <div class="option">
            <div><b>Select Device</b></div>
            <div><select id="input-0">${buildDeviceOptions()}</select></div>
          </div>`);
      }
    }
  });

  // save handler (mostly same but uses cached device.buttons length)
  $(document).on("click", "#save-button", function () {
    if ($("#input-0").val() === "null") return;

    const inputs = {};
    const binds = {};
    for (let i = 0; i < 6; i++) {
      const el = $("#input-" + i);
      inputs[i] = (el && el.val()) ? el.val() : null;
    }

    const gp = navigator.getGamepads()[deviceIndex];
    const buttonsLen = gp ? gp.buttons.length : (Object.keys(deviceSettings.binds || {}).length || 0);
    for (let i = 0; i < buttonsLen; i++) {
      const sel = $(`#button-${i} #button-select-${i}`);
      const v0 = $(`#button-${i} #button-input-${i}-0`).val();
      const v1 = $(`#button-${i} #button-input-${i}-1`).val();
      binds[i] = {
        type: sel.length ? sel.val() : 'control',
        values: [safeValue(v0), safeValue(v1)]
      };
    }

    updateSettings({inputs, binds});
    initApp(deviceIndex);
  });

  $(document).on("click", "#close", function () {
    $("#container").animate({opacity: 0}, 'fast');
    fetch('https://pickle_wheel/close', {
      method: 'post',
      headers: {'Accept':'application/json','Content-Type':'application/json'},
      body: JSON.stringify({})
    }).catch(()=>{});
  });
});

window.addEventListener('gamepadconnected', function(e) {
  $("#input-0").html(buildDeviceOptions());

  elemWheel    = document.getElementById('wheel');
  elemThrottle = document.querySelector('#throttle > span');
  elemBrake    = document.querySelector('#brake > span');
  elemClutch   = document.querySelector('#clutch > span');
});

window.addEventListener("message", function(ev) {
  const event = ev.data;
  if (event.type === "updateSettings") {
    updateSettings(event.data, true);
  } else if (event.type === "open") {
    $("#container").animate({opacity: 1}, 'fast');
  }
});
