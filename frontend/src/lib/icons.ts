/**
 * Auswahl gängiger Material Design Icons für den Icon-Picker.
 * Format: mdi:<name>
 */

export interface IconDef {
  name: string;
  value: string;
  category: string;
}

export const COMMON_ICONS: IconDef[] = [
  // Home & Navigation
  { name: "Home", value: "mdi:home", category: "Navigation" },
  { name: "Menü", value: "mdi:menu", category: "Navigation" },
  { name: "Zurück", value: "mdi:arrow-left", category: "Navigation" },
  { name: "Weiter", value: "mdi:arrow-right", category: "Navigation" },
  { name: "Hoch", value: "mdi:arrow-up", category: "Navigation" },
  { name: "Runter", value: "mdi:arrow-down", category: "Navigation" },
  { name: "Schließen", value: "mdi:close", category: "Navigation" },
  { name: "Mehr", value: "mdi:dots-vertical", category: "Navigation" },

  // Status & Feedback
  { name: "Check", value: "mdi:check", category: "Status" },
  { name: "Daumen hoch", value: "mdi:thumb-up", category: "Status" },
  { name: "Daumen runter", value: "mdi:thumb-down", category: "Status" },
  { name: "Herz", value: "mdi:heart", category: "Status" },
  { name: "Stern", value: "mdi:star", category: "Status" },
  { name: "Info", value: "mdi:information", category: "Status" },
  { name: "Warnung", value: "mdi:alert", category: "Status" },
  { name: "Fehler", value: "mdi:alert-circle", category: "Status" },

  // Geräte & Smarthome
  { name: "Glühbirne", value: "mdi:lightbulb", category: "Smarthome" },
  { name: "Licht An", value: "mdi:lightbulb-on", category: "Smarthome" },
  { name: "Licht Aus", value: "mdi:lightbulb-off", category: "Smarthome" },
  { name: "Ventilator", value: "mdi:fan", category: "Smarthome" },
  { name: "Thermostat", value: "mdi:thermostat", category: "Smarthome" },
  { name: "Temperatur", value: "mdi:thermometer", category: "Smarthome" },
  { name: "Heizung", value: "mdi:radiator", category: "Smarthome" },
  { name: "Klimaanlage", value: "mdi:air-conditioner", category: "Smarthome" },
  { name: "Tür", value: "mdi:door", category: "Smarthome" },
  { name: "Fenster", value: "mdi:window-closed", category: "Smarthome" },
  { name: "Jalousie", value: "mdi:blinds", category: "Smarthome" },
  { name: "Garage", value: "mdi:garage", category: "Smarthome" },
  { name: "Kamera", value: "mdi:camera", category: "Smarthome" },
  { name: "Schloss", value: "mdi:lock", category: "Smarthome" },
  { name: "Entsperrt", value: "mdi:lock-open", category: "Smarthome" },

  // Media
  { name: "Play", value: "mdi:play", category: "Media" },
  { name: "Pause", value: "mdi:pause", category: "Media" },
  { name: "Stop", value: "mdi:stop", category: "Media" },
  { name: "Vor", value: "mdi:skip-next", category: "Media" },
  { name: "Zurück", value: "mdi:skip-previous", category: "Media" },
  { name: "Lautstärke", value: "mdi:volume-high", category: "Media" },
  { name: "Stumm", value: "mdi:volume-off", category: "Media" },
  { name: "Musik", value: "mdi:music", category: "Media" },

  // Wetter
  { name: "Sonne", value: "mdi:weather-sunny", category: "Wetter" },
  { name: "Wolken", value: "mdi:weather-cloudy", category: "Wetter" },
  { name: "Regen", value: "mdi:weather-rainy", category: "Wetter" },
  { name: "Gewitter", value: "mdi:weather-lightning", category: "Wetter" },
  { name: "Schnee", value: "mdi:weather-snowy", category: "Wetter" },
  { name: "Nacht", value: "mdi:weather-night", category: "Wetter" },

  // Zeit & Kalender
  { name: "Uhr", value: "mdi:clock", category: "Zeit" },
  { name: "Timer", value: "mdi:timer", category: "Zeit" },
  { name: "Kalender", value: "mdi:calendar", category: "Zeit" },
  { name: "Wecker", value: "mdi:alarm", category: "Zeit" },

  // Verschiedenes
  { name: "Einstellungen", value: "mdi:cog", category: "System" },
  { name: "Power", value: "mdi:power", category: "System" },
  { name: "Akku", value: "mdi:battery", category: "System" },
  { name: "WLAN", value: "mdi:wifi", category: "System" },
  { name: "Bluetooth", value: "mdi:bluetooth", category: "System" },
  { name: "Handy", value: "mdi:cellphone", category: "System" },
  { name: "Laptop", value: "mdi:laptop", category: "System" },
  { name: "Desktop", value: "mdi:desktop-tower", category: "System" },
];

export const ICON_CATEGORIES = Array.from(new Set(COMMON_ICONS.map(i => i.category)));
