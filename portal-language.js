(() => {
  'use strict';
  const select=document.getElementById('portalLanguage');
  if(!select)return;
  const root=document.getElementById('app')||document.body;
  const english=new Map(Object.entries({
    'Zum Dashboard':'Go to dashboard', 'Anmelden':'Sign in', 'Passwort':'Password', 'Anzeigen':'Show',
    'Verbergen':'Hide', 'Passwort vergessen?':'Forgot password?', 'Passwort zurücksetzen':'Reset password',
    'E-Mail-Adresse':'Email address','E-Mail':'Email','Zur Anmeldung':'Back to sign in',
    'Gib die E-Mail-Adresse deines ChargeVisor-Kontos ein. Wir schicken dir einen einmaligen Link per E-Mail.':'Enter the email address for your ChargeVisor account. We’ll email you a one-time link.',
    'Neues Passwort festlegen':'Set a new password', 'Neues Passwort (mindestens 12 Zeichen)':'New password (at least 12 characters)',
    'Neues Passwort wiederholen':'Repeat new password','Passwort ändern':'Change password', 'Link anfordern':'Request a link',
    'Authentifizierung wird geprüft …':'Checking authentication …',
    'Der Link ist 30 Minuten gültig und kann nur einmal verwendet werden.':'This link is valid for 30 minutes and can be used once.',
    'Einladung annehmen':'Accept invitation','Zugang aktivieren':'Activate account',
    'Lege dein Passwort fest. Der Einladungslink ist einmalig und 72 Stunden gültig.':'Set your password. The invitation link can be used once and is valid for 72 hours.',
    'LADEMANAGEMENT':'CHARGING MANAGEMENT', 'Übersicht':'Overview', 'Standorte & Ladepunkte':'Sites & charge points',
    'Meine Ladepunkte':'My charge points', 'Ladevorgänge':'Charging sessions', 'Meine Ladevorgänge':'My charging sessions',
    'Ladevorgänge & Berichte':'Charging sessions & reports', 'Kundenverwaltung':'Customers', 'Nutzerverwaltung':'User management',
    'Einstellungen':'Settings', 'Abmelden':'Sign out', 'Rollenansicht':'Role preview', 'Menü öffnen':'Open menu',
    'Aktueller Kunde':'Current customer','AKTUELLER KUNDE':'CURRENT CUSTOMER','KUNDE':'CUSTOMER','Sprache':'Language',
    'Kunde in allen Menüs wechseln':'Switch customer on all pages', 'Kunden-Admin':'Customer admin',
    'Schreibgeschützte Vorschau':'Read-only preview', 'Zurück zum Superadmin':'Return to superadmin',
    'Gesicherte Kundenverwaltung':'Secure customer management','Ladeinfrastruktur im Überblick':'Charging infrastructure overview',
    'Status, Energieverbrauch und Ladevorgänge':'Status, energy consumption and charging sessions',
    'Deine zugewiesenen Ladepunkte.':'Your assigned charge points.',
    'Systemstatus':'System status', '✓ Alles OK':'✓ All systems OK', 'Störung erkannt':'Issue detected',
    'Status unvollständig':'Status incomplete', 'Ladepunkte':'Charge points', 'Ladepunkt':'Charge point',
    'Eingerichtete Ladepunkte':'Configured charge points', 'Laden gerade':'Charging now',
    'Echte OCPP-Statusmeldungen':'Live OCPP status', 'Verbindung unterbrochen':'Connection interrupted',
    'Störungen':'Issues', 'Warnungen und Fehler':'Warnings and faults', 'Standorte':'Sites', 'Standort':'Site',
    'Eingerichtete Standorte':'Configured sites', 'Bereit / lädt':'Available / charging',
    'Störung':'Issue', 'Kein Status / stillgelegt':'No status / disabled','Details ansehen ›':'View details ›',
    'Noch keine Standorte eingerichtet.':'No sites configured yet.','Noch keine Statusdaten':'No status data yet',
    'Ladeleistung heute':'Charging power today', 'Ladeleistung je Zeitpunkt':'Charging power over time',
    'Für heute sind noch keine Leistungswerte verfügbar.':'No power readings are available for today yet.',
    'Messwerte werden geladen …':'Loading meter readings …','Teilsummen bei fehlenden Meldungen.':'Partial totals where readings are missing.',
    'Messgröße':'Metric','Leistung (kW)':'Power (kW)','Energie (kWh)':'Energy (kWh)',
    'Aktuell':'Now','Aktuell gemessen':'Currently reported','Im Zeitraum':'For this period',
    'Keine aktuelle Messung':'No current reading','Aktuelle Leistung':'Current power',
    'Keine aktiven Ladepunkte':'No active charge points','Keine Statusdaten':'No status data',
    'OCPP-Verbindung unterbrochen':'OCPP connection lost',
    'Ladestecker verriegelt nicht':'Charging connector failed to lock',
    'Monat':'Month','Monat wählen':'Choose month','Vorheriger Monat':'Previous month','Nächster Monat':'Next month',
    'Zeitraum frei wählen':'Custom date range','Exportieren':'Export',
    'Das Ende muss am oder nach dem Beginn liegen.':'The end date must be on or after the start date.',
    'Ladeenergie im Zeitverlauf':'Charging energy over time', 'Ladeenergie je Zeitraum':'Energy per period',
    'Alle Standorte':'All sites', 'Zeitraum':'Period', 'Heute':'Today', 'Diese Woche':'This week',
    'Dieser Monat':'This month', 'Dieses Jahr':'This year', 'Gesamter Zeitraum':'All time',
    'Keine gemessene Ladeenergie im gewählten Zeitraum.':'No metered charging energy in the selected period.',
    'Keine Messung':'No measurement', 'Letzte Ladevorgänge':'Recent charging sessions',
    'Ladevorgänge ansehen ›':'View charging sessions ›', 'Noch keine Ladevorgänge.':'No charging sessions yet.',
    'Beginn':'Start', 'Nutzer':'User', 'Energie':'Energy', 'Betrag':'Amount', 'Beendet':'Ended', 'Aktiv':'Active',
    'Bereit':'Available', 'Verbunden':'Connected', 'Nicht verbunden':'Disconnected', 'Lädt':'Charging',
    'Pausiert':'Paused', 'Warnung':'Warning', 'Fehler':'Fault', 'Stillgelegt':'Disabled', 'Nicht zugewiesen':'Unassigned',
    'Standort oder Ladepunkt suchen …':'Search sites or charge points …',
    'Noch keine Standorte oder Ladepunkte vorhanden.':'No sites or charge points configured yet.',
    '+ Standort':'+ Site', '+ Ladestation':'+ Charging station', '+ Kunde':'+ Customer',
    'Ladestation':'Charging station', 'Standort & Adresse bearbeiten':'Edit site and address',
    'OCPP-Zugangsdaten':'OCPP credentials', 'OCPP-ANBINDUNG':'OCPP CONNECTION', 'OCPP-Anbindung':'OCPP connection',
    'Technik durch Walectra':'Technical management by Walectra', 'Weniger':'Show less', 'Seriennummer':'Serial number',
    'Nicht hinterlegt':'Not available', 'Noch nicht gemeldet':'Not reported yet', 'Hersteller':'Manufacturer',
    'Modell':'Model', 'Firmwarestand':'Firmware version', 'OCPP-Geräte-ID':'OCPP device ID',
    'Letzte OCPP-Nachricht':'Last OCPP message', 'Keine Daten':'No data', 'Empfangene Energie':'Metered energy',
    'Nutzer zuweisen':'Assign users', 'Umbenennen':'Rename', 'Aktivieren':'Enable','Deaktivieren':'Disable',
    'Ladepunkte erweitern':'Add charge points', 'Ladepunktnamen (jeweils eine Zeile)':'Charge point names (one per line)',
    'Die neuen Connectoren folgen auf die vorhandenen Nummern.':'New connectors continue the existing numbering.',
    'Jeder neue Ladepunkt erhält eigene OCPP-Zugangsdaten.':'Each new charge point receives its own OCPP credentials.',
    'Erweitern':'Add', 'Ladestation neu starten':'Restart station', 'Ladevorgang starten':'Start charging',
    'Ladevorgang fortsetzen':'Resume charging', 'Ladevorgang pausieren':'Pause charging',
    'Ladevorgang stoppen':'Stop charging', 'Möchtest du den Ladevorgang wirklich stoppen?':'Stop this charging session?',
    'Möchtest du die Ladestation wirklich neu starten?':'Restart this charging station?',
    'Wallbox hat den Befehl angenommen.':'The charging station accepted the command.',
    'Premium-Funktion':'Premium feature', 'Premium-Funktion. Kontaktiere Walectra für die Freischaltung.':'Premium feature. Contact Walectra to enable it.',
    'In Outlook schreiben':'Write in Outlook', 'Schließen':'Close', 'Abbrechen':'Cancel', 'Speichern':'Save',
    'Ladesteuerung':'Charging controls', 'Ladesteuerung freigeben':'Enable charging controls',
    'Starten, pausieren und stoppen':'Start, pause and stop', 'Freigaben':'Permissions', 'Freigaben gespeichert.':'Permissions saved.',
    'Von':'From', 'Bis':'To', 'Filtern':'Apply filters', 'Alle Nutzer':'All users',
    'CSV herunterladen':'Download CSV', 'Excel herunterladen':'Download Excel', 'PDF-Ladebericht herunterladen':'Download PDF charging report',
    'PDF-Ladebericht':'PDF charging report', 'Energie aus gemeldeten Zählerständen.':'Energy based on reported meter readings.',
    'Keine Ladevorgänge für diesen Filter.':'No charging sessions match the filters.',
    'Ladevorgänge werden geladen …':'Loading charging sessions …',
    'Die Übersicht zeigt bis zu 100 Treffer. CSV und Excel enthalten alle Treffer. Zeitraum in Berliner Ortszeit.':'The list shows up to 100 sessions. CSV and Excel include all matches. Dates use Berlin local time.',
    '+ Nutzer hinzufügen':'+ Add user', '+ Nutzer einladen':'+ Invite user', 'Zuweisen':'Assign',
    'Portal-Einladungen bei Walectra freigeben lassen.':'Contact Walectra to enable portal invitations.',
    'Nutzerprofile verwalten und Ladepunkte zuweisen.':'Manage users and assign charge points.',
    'Zurück zur Kundenverwaltung':'Back to customers', 'Name oder E-Mail suchen …':'Search by name or email …',
    'Rolle':'Role', 'Aktion':'Action', 'Noch keine Nutzer.':'No users yet.',
    'Karten und Ladeberechtigungen verwalten.':'Manage cards and charging access.',
    'Nutzerverwaltung öffnen':'Open user management', 'RFID-Karten verwalten':'Manage RFID cards',
    'Kundeninformationen und Freigaben.':'Customer details and permissions.',
    'Kunden, Ansprechpartner und technische Konfiguration.':'Customers, contacts and technical settings.',
    'Kundenkonto':'Customer account', 'Kundendaten bearbeiten':'Edit customer details',
    'Kontaktperson':'Contact person', 'Kontakt E-Mail':'Contact email', 'Telefon':'Phone', 'Noch nicht hinterlegt':'Not set',
    'Ladetarif':'Charging rate', 'Preis in €/kWh':'Price in €/kWh', 'Tarif speichern':'Save rate',
    'Der Tarif gilt für neue Ladevorgänge ab ihrem Start.':'The rate applies to new sessions from the moment they start.',
    'Ladetarif gespeichert.':'Charging rate saved.', 'Öffnen':'Open', 'Nutzer verwalten':'Manage users',
    'Kunde':'Customer', 'Konto':'Account', 'Kundenstatus':'Customer status', 'Gesperrt':'Suspended',
    'In Vorbereitung':'Pending', 'Kundenname / Firmenname / WEG':'Customer / company / property association',
    'Ansprechpartner':'Primary contact', 'Name der Kontaktperson':'Contact name', 'Telefonnummer':'Phone number',
    'Kontaktperson per E-Mail als Kunden-Admin einladen':'Invite contact by email as customer admin',
    'Kunde erstellen':'Create customer', 'Änderungen speichern':'Save changes', 'Passwort-Link senden':'Send password reset link',
    'Nutzer hinzufügen':'Add user', 'Nutzer zum Portal einladen':'Invite users to the portal',
    'PDF-Ladeberichte herunterladen':'Download PDF reports', 'Freigaben speichern':'Save permissions',
    'Ladepunkte zuweisen':'Assign charge points', 'Alle aktiven Ladepunkte':'All active charge points',
    'Alle derzeit aktiven Ladepunkte':'All currently active charge points',
    'Bestehende Freigaben bleiben erhalten.':'Existing permissions are kept.',
    'RFID-Daten werden geladen …':'Loading RFID data …', 'Kürzlich gelesene Karten':'Recently scanned cards',
    'Halte eine Karte an die Wallbox. Sobald sie hier erscheint, kannst du sie einem Nutzer zuordnen.':'Tap a card on a charger. Once it appears here, you can assign it to a user.',
    'Karte zuordnen':'Assign card', 'Kartenname':'Card name', 'Ladepunkte freigeben':'Grant charge point access',
    'Manuell eingeben oder gezielt einlesen':'Enter manually or scan a card',
    'Wallbox zum Einlesen':'Charger to scan the card on', 'Keine Wallbox ausgewählt':'No charger selected',
    'Karte an Wallbox einlesen':'Scan card on charger', 'Kartenkennung (OCPP idTag)':'Card identifier (OCPP idTag)',
    'Uhrzeit (Berlin)':'Time (Berlin)', 'Wallbox':'Charger', 'Auswählen':'Select',
    'Aktuell sind keine Kartenlesungen verfügbar.':'No recent card scans.', 'Zugeordnete Karten':'Assigned cards',
    'Nutzer auswählen':'Select a user', 'Zugewiesener Nutzer':'Assigned user','Einlesen abbrechen':'Cancel scan',
    'Standortname':'Site name', 'Straße':'Street', 'Hausnummer':'House number', 'Postleitzahl':'Postcode',
    'Ort':'City', 'Land':'Country', 'Vollständige Standortadresse für die Ladeinfrastruktur.':'Enter the full address for this charging site.',
    'Name der Ladestation':'Charging station name', 'Anzahl Ladepunkte':'Number of charge points',
    'OCPP-Verbindung bei mehreren Ladepunkten':'OCPP connection for multiple charge points',
    'Eine OCPP-Verbindung (Master mit Connectoren)':'One OCPP connection (master with connectors)',
    'Eigene OCPP-Verbindung je Wallbox':'Separate OCPP connection for each charger',
    'Ladepunkte benennen':'Name the charge points', 'Erweiterte Angaben (optional)':'Advanced details (optional)',
    'Seriennummer / Anlagenkennung':'Serial number / equipment ID', 'Feste OCPP-ID der Wallbox':'Fixed OCPP ID of the charger',
    'Speichern & Verbindungsdaten anzeigen':'Save and show connection details',
    'OCPP-Verbindung':'OCPP connection', 'Kopieren':'Copy', 'Passwort neu erzeugen':'Generate new password',
    'Wallbox verbinden':'Connect charger', 'Konfiguration öffnen':'Open configuration',
    'Diese Ladestation hat noch keine OCPP-Zugangsdaten.':'This station has no OCPP credentials yet.',
    'OCPP-Zugangsdaten erstellen':'Create OCPP credentials','Lademodus':'Charging mode',
    'RFID erforderlich':'RFID required', 'Freecharge (Einstecken und laden)':'Freecharge (plug in and charge)',
    'Lademodus speichern':'Save charging mode', 'Zuweisungen speichern':'Save assignments',
    'Name des Ladepunkts':'Charge point name', 'Ladepunktname':'Charge point name', 'Bestätigen':'Confirm',
    'Ladepunkte für den Nutzer':'Charge points for this user',
    'Noch keine aktiven Ladepunkte. Walectra muss zuerst Geräte anlegen.':'No active charge points. Walectra must add devices first.',
    'Geschäftspostfach und Einladungsversand verwalten.':'Manage the business mailbox and invitations.',
    'Outlook-Verbindung verwalten':'Manage Outlook connection',
    'ChargeVisor verbindet Wallboxen über OCPP 1.6 JSON.':'ChargeVisor connects chargers over OCPP 1.6 JSON.',
    'Bearbeiten':'Edit', 'Kunde archivieren':'Archive customer', 'Noch keine Kunden angelegt.':'No customers yet.'
  }));
  const translate=value=>value.replace(/\S(?:.*\S)?/s,phrase=>english.get(phrase)??phrase);
  function refresh(){
    if(select.value!=='en')return;
    const nodes=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(nodes.nextNode()){
      const node=nodes.currentNode;
      if(node.parentElement.closest('#portalLanguage,script,style,input,textarea'))continue;
      const text=translate(node.textContent);
      if(text!==node.textContent)node.textContent=text;
    }
    for(const el of root.querySelectorAll('[title],[placeholder],[aria-label]'))
      for(const key of ['title','placeholder','aria-label']){
        const value=el.getAttribute(key);
        if(value!==null&&value!==translate(value))el.setAttribute(key,translate(value));
      }
  }
  let saved;
  try{saved=window.localStorage.getItem('chargevisor-language');}catch{}
  select.value=saved==='en'?'en':'de';
  document.documentElement.lang=select.value;
  select.addEventListener('change',()=>{
    try{window.localStorage.setItem('chargevisor-language',select.value);}catch{
      select.value=document.documentElement.lang;
      return;
    }
    window.location.reload();
  });
  if(select.value==='en'){
    new MutationObserver(refresh).observe(root,{subtree:true,childList:true,characterData:true});
    refresh();
  }
})();
