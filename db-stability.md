# Datenbank-Stabilität: Postmortem und Notfallhandbuch

Stand: 14.08.2026

Status: Der Produktionsrollout der DB-/Social-Stabilität ist abgeschlossen. Client
`zane-v2.789`, alle sechs Stabilitätsmigrationen, `db-health`, Better Stack sowie
globale Social- und Coaching-Broadcasts sind aktiv. Die hier beschriebene
Auth-/Offline-Recovery liegt zusätzlich auf dem separaten Branch
`codex/offline-auth-recovery` und ist noch nicht in Produktion.

## Die einfache Erklärung

Die Datenbank hat 60 Sitzplätze. Ein normaler App-Start, Social-Polling und Synchronisierung konnten bisher sehr viele Gäste gleichzeitig zur Tür schicken. Sobald die Datenbank langsamer wurde, kamen neue Gäste schneller nach, als alte fertig wurden. Die Schlange machte die Datenbank noch langsamer. Am Ende standen Login und Auth gemeinsam mit unwichtigen Hintergrundabfragen vor derselben vollen Tür.

Der neue Aufbau hat sechs Sicherungen:

1. Maximal vier Supabase-HTTP-Anfragen pro App-Instanz.
2. Höchstens zwei Hintergrundabfragen und zwei Writes gleichzeitig.
3. Timer starten erst nach Abschluss des vorherigen Requests.
4. Nach wiederholten Timeouts pausiert optionale Arbeit automatisch.
5. Ein globaler Schalter kann Friends sofort abschalten.
6. Ein externer Health-Check warnt, bevor alle Verbindungen belegt sind.

Das Ziel ist nicht die unmögliche Garantie, dass Supabase oder das Internet nie ausfallen. Das Ziel ist: Wenn Friends oder eine Hintergrundfunktion durchdreht, wird dieser Teil abgeworfen, bevor Login und Training betroffen sind.

## Vorfall vom 13.08.2026

Alle Uhrzeiten in diesem Abschnitt sind Europe/Vienna, also UTC+2.

- Ab etwa 21:30 stiegen Requestzahl und Query-Laufzeiten stark an.
- Ab etwa 22:50 traten sehr lange DB-Wartezeiten, Login-Timeouts und Realtime-Fehler auf.
- Cron-Jobs und andere DB-Verbraucher bekamen zeitweise keine Verbindung.
- Ein späterer Projekt-Neustart leerte den festgefahrenen Zustand.

### Was belegt ist

- Die Instanz hat `max_connections = 60`; im gesunden Zustand waren ungefähr 29 Verbindungen bereits belegt.
- Ein App-Start erzeugte einen großen Fan-out unabhängiger Reads.
- Synchronisierung konnte viele Writes parallel starten.
- Der Live-Workout-Viewer startete alle zwei Sekunden einen neuen Request, auch wenn der alte noch lief.
- Der Social-Feed pollte alle fünf Sekunden auf jeder Route, sobald Friends aktiviert war.
- Das vollständige Social-Dashboard wurde als Badge-Fallback verwendet.
- Während der Störung erschien `IncreaseSubscriptionConnectionPool: Too many database timeouts`.
- `net._http_response` war ungewöhnlich groß und die Aufbewahrung länger als für den Betrieb nötig.

### Was daraus folgt

Die nachweisbare Fehlerkette ist fehlender Gegendruck: Eine langsamer werdende DB bekam weiter neue Reads und Writes. Überlappende Polls und Boot-Bursts vergrößerten die Warteschlange. Kritische und optionale Arbeit konkurrierten um dieselben knappen Verbindungen.

Der Realtime-Fehler ist ein Symptom von DB-Timeouts. Er belegt nicht, dass Realtime seinen Connection-Pool tatsächlich vergrößert und dadurch den Ausfall verursacht hat. Diese frühere Advisor-Aussage wird nicht als Ursache geführt.

### Was nicht bewiesen ist

- Welcher einzelne Request den ersten Kipppunkt ausgelöst hat.
- Dass eine bestimmte Migration den Vorfall ausgelöst hat.
- Dass Realtime automatisch zusätzliche Verbindungen reserviert hat.

## Implementierte Schutzschichten

### Client-Zulassung

`src/store.js` setzt eine harte Grenze von vier gleichzeitigen Supabase-HTTP-Requests. Die interne Warteschlange priorisiert kritische Saves vor Vordergrund-Reads und Hintergrundarbeit. Hintergrundarbeit und Writes haben jeweils ein eigenes Limit von zwei.

Ein Cache-Boot zeigt die lokalen Daten sofort, verzögert die Server-Hydrierung aber zufällig um 0 bis 15 Sekunden. Dadurch starten nach einem Reload nicht alle Geräte im selben Moment.

### Auth- und Offline-Recovery

Die Authentifizierung verwendet eine eigene, auf eine Anfrage begrenzte Spur.
`/auth/v1/*` wartet nicht mehr hinter PostgREST-, Realtime- oder Hintergrund-
Requests. Auth-Anfragen werden nach acht Sekunden abgebrochen; 408, 425, 429,
5xx und Netzwerkfehler werden von `supabase-js` als vorübergehend retrybar
behandelt. Dadurch darf ein kurzzeitig nicht erreichbarer Auth-/DB-Dienst die
gespeicherte Session nicht als endgültig widerrufen.

`persistSession`, `autoRefreshToken` und `detectSessionInUrl` sind im Client
explizit aktiviert. Zusätzlich merkt sich der Browser nur die ID des zuletzt
angemeldeten Kontos und einen 24-Stunden-Recovery-Lease. Es wird kein zweiter
Refresh- oder Access-Token gespeichert.

Wenn Auth vorübergehend nicht erreichbar ist, öffnet ein bereits angemeldeter
Browser seinen lokalen Trainingscache wieder. Training und lokale Änderungen
bleiben verfügbar; Server- und Social-Abfragen pausieren. Sobald ein gültiger
JWT wiederhergestellt ist, lädt der Client den Serverstand cache-first und
überträgt den offenen Diff mit dem bestehenden geordneten Sync.

Eine echte Abmeldung, Passwortänderung oder serverseitig widerrufene Session
führt weiterhin zu einer erneuten Anmeldung. Der lokale Diff bleibt dabei
erhalten und wird nach einer erfolgreichen Anmeldung desselben Kontos wieder
verarbeitet. Ein expliziter Logout löscht Recovery-Lease und lokalen Cache.

Für eine Preview darf der Build ausschließlich die Preview-URL und den
öffentlichen `anon`-Schlüssel über `ZANE_SUPABASE_URL` und
`ZANE_SUPABASE_ANON_KEY` erhalten. Ein `service_role`-Schlüssel gehört niemals
in den Client oder in Git. Ohne diese Variablen bleibt der Produktionsendpunkt
der sichere Standard.

### Schutzschalter

Zwei aufeinanderfolgende Timeouts, Netzwerkfehler, HTTP 429 oder 5xx öffnen den lokalen Schutzschalter. Optionale DB-Arbeit pausiert fünf Minuten. Danach ist genau eine Probe erlaubt. Schlägt sie fehl, pausiert die optionale Arbeit 15 Minuten. Fachliche Validierungs- und Berechtigungsfehler öffnen den Schalter nicht.

Training und kritische Saves bleiben lokal erhalten. Der normale Sync versucht sie später kontrolliert erneut.

### Polling

- Friends-Feed: nur auf der Friends-Seite, alle zehn Sekunden, niemals überlappend.
- Live-Workout-Viewer: fünf Sekunden live, 15 Sekunden nach Ende, niemals überlappend.
- Training-Feedback: fünf Sekunden, niemals überlappend.
- Badge außerhalb von Friends: `social_get_badge()` statt Dashboard, alle zwei Minuten plus Zufallsversatz.
- Fehlerabstand: 5, 10, 30, danach maximal 60 Sekunden.
- Der Realtime-Kanalname ist stabil und wird über eine Registry geteilt.

### Globaler Friends-Schalter

`zane_app_config.social_mode` kennt `normal` und `maintenance`. `social_transport` und `coaching_transport` kennen jeweils `broadcast` und `legacy`.

- `admin_set_social_mode(p_mode)` ist nur für `office@btc-prime.biz` ausführbar.
- `admin_set_social_transport(p_transport)` ist der globale Broadcast-Rollback und ebenfalls nur für die Admin-Adresse ausführbar.
- `admin_set_coaching_transport(p_transport)` schaltet Coaching, Support und Coach-Status global. Bei `legacy` stellt der RPC zuerst die vier Publication-Tabellen wieder her.
- `get_runtime_config()` liefert Update-Nonce, Social-Modus und beide globalen Transportwerte.
- Neue Clients zeigen im Wartungsmodus eine Wartungsseite und starten keine Social-RPCs, Polls oder Channels. Moderationszugriff auf `zane_social_reports` bleibt für den Admin und den jeweiligen Reporter erhalten, damit ein Vorfall weiterhin bearbeitet werden kann.
- Restriktive RLS-Policies blockieren die Social-Tabellen und den privaten Attachment-Bucket.
- Alle clientseitig erreichbaren Social-RPCs prüfen den Modus vor ihrer bisherigen Implementierung.
- Login, Training, Health und der normale Sync hängen nicht vom Social-Modus ab.

Der Admin-Schalter liegt in Settings > Admin > Database stability.

### Günstigere Queries

- `get_exercise_best_e1rm` filtert Sets explizit nach `user_id` und nutzt `zane_sets_user_entry_idx(user_id, entry_id)`.
- `get_session_stats(p_user_id, p_cutoff)` aggregiert beim Boot nur Sessions vor der 70-Tage-Grenze.
- `social_get_badge()` zählt nur offene Anfragen und ungelesene Nachrichten.
- `social_get_dashboard` ermittelt sichtbare Metriken pro Besitzer einmal und aggregiert sie set-basiert.
- Message-Signale laden nur Messages, Reads und Attachments neu, nicht das gesamte Dashboard.

### Globaler Broadcast-Transport

Jeder Nutzer hat genau ein privates Topic: `social:user:<user-id>`.

Trigger senden über `realtime.send()` nur ein inhaltsloses Invalidierungssignal, zum Beispiel:

```json
{ "resource": "messages", "id": "<opaque-event-uuid>" }
```

Der Trigger übergibt nur `resource`; Supabases `realtime.send()` ergänzt technisch eine zufällige, inhaltslose Event-UUID als `id`. Es werden keine Nutzer-/Datensatz-IDs, Nachrichten, Namen, Gesundheitswerte, Workout-Daten oder vollständigen Zeilen übertragen. Nach dem Signal liest der Client die betroffene Ressource wieder regulär über RLS oder RPC. Signale innerhalb von 250 ms werden zusammengefasst. Nach Reconnect oder App-Fokus folgt ein autoritativer Abruf.

`social_transport = 'broadcast'` gilt automatisch für jeden aktuellen und zukünftigen Friends-Nutzer. `legacy` schaltet alle Clients spätestens beim nächsten zweiminütigen Runtime-Config-Abruf auf Postgres Changes zurück. Die alte Social-Publication bleibt als sofortiger Rückweg aktiv.

Coaching verwendet getrennt davon `coaching:user:<user-id>` und ausschließlich die Ressourcen `relationships`, `notes`, `support` und `status`. Die vier app-eigenen Tabellen `zane_coaching`, `zane_coaching_notes`, `zane_user_settings` und `zane_checkins` sind im normalen Broadcast-Betrieb nicht mehr in `supabase_realtime`. Broadcast-Fehler werden im Trigger abgefangen und können deshalb keinen Coaching- oder Training-Write zurückrollen. Offene Chats aktualisieren nach einem Signal autoritativ; ihre 60-Sekunden-Polls sind nur noch Fallbacks. `door_events` und `motion_events` gehören einer anderen Anwendung und bleiben unverändert.

## Monitoring einrichten

### Edge Function `db-health`

Deployment-Konfiguration:

- JWT-Prüfung für die Function deaktivieren, weil ein eigener zufälliger Monitor-Token verwendet wird.
- Secret `DB_HEALTH_TOKEN` auf einen langen zufälligen Wert setzen.
- Der Monitor sendet denselben Wert als Header `x-health-token`.
- Die Function bricht den DB-Aufruf nach fünf Sekunden ab.

Gesund bedeutet HTTP 200. Kritisch oder technisch nicht erreichbar bedeutet HTTP 503. Die Antwort enthält nur Verbindungs- und Warteaggregate, keine Nutzerdaten und keine Query-Texte.

Kritische Bedingungen:

- mindestens 45 belegte DB-Verbindungen,
- wartende Client-DB-Queries,
- aktive Client-Query länger als fünf Sekunden,
- Health-RPC oder Function schlägt fehl.

Zusätzlich wird die Größe von `net._http_response` gemeldet, damit erneutes Wachstum sichtbar wird.

### Better Stack

Zwei Monitore im Drei-Minuten-Takt:

1. Öffentliche Cloudflare-App `https://zane-wo.com/`.
2. `https://ebbuvdzgstrhrcsbrlez.supabase.co/functions/v1/db-health` mit `x-health-token`.

Alarm und Entwarnung gehen ab dem ersten fehlgeschlagenen Check an `office@btc-prime.biz`. Die genaue Better-Stack-Konfiguration ist ein externer Betriebsschritt und nicht im Repository ausführbar.

Produktionsstand vom 14.08.2026: `Zane app` und `Zane DB health Production` sind aktiv und werden alle drei Minuten geprüft. Beide verwenden einen sofortigen Incident-Start, sofortige Entwarnung und E-Mail-Benachrichtigung. Better Stack meldet den geschützten Produktions-Health-Endpunkt `Up` mit 100 Prozent Verfügbarkeit und null Incidents. Damit ist der HTTP-200-Pfad der Production-Function samt `x-health-token` praktisch verifiziert. Das Team besteht derzeit ausschließlich aus `office@btc-prime.biz`, daher geht die Benachrichtigung an diese Adresse.

## Notfallablauf

Wenn Login-Timeouts, DB-Timeouts oder ein Alarm auftreten:

1. In Settings > Admin > Database stability sofort `Pause Friends` drücken. Falls die App nicht erreichbar ist, `admin_set_social_mode('maintenance')` über eine authentifizierte Admin-Session ausführen.
2. Den `db-health`-Status, belegte Verbindungen, wartende Queries und Realtime-Logs prüfen.
3. Keine Migration, keinen Force-Reload und keinen Broadcast-Rollout starten.
4. Drei bis fünf Minuten warten und beobachten, ob Verbindungen und Wartezeiten fallen.
5. Nur wenn die Notbremse die DB nicht freigibt, einen Projekt-Neustart als letzte Maßnahme erwägen.
6. Nach Stabilisierung Friends noch nicht sofort aktivieren. Erst Ursache und Requestrate prüfen, dann kontrolliert auf `normal` zurückschalten.

Nützliche Diagnoseabfrage ohne Query-Inhalte:

```sql
select
  count(*) filter (where datname = current_database()) as connections,
  count(*) filter (
    where datname = current_database()
      and state = 'active'
      and backend_type = 'client backend'
      and wait_event_type is not null
  ) as waiting,
  count(*) filter (
    where datname = current_database()
      and state = 'active'
      and backend_type = 'client backend'
      and query_start < clock_timestamp() - interval '5 seconds'
  ) as over_five_seconds
from pg_stat_activity;
```

## Datenbank-Betrieb

- Das effektive `statement_timeout` von acht Sekunden bleibt bestehen. Es wird kein 30-Sekunden-Limit eingeführt.
- `pg_net.ttl` steht weiterhin auf sechs Stunden. Supabase CLI 2.114.0 lehnt den laut Dokumentation unterstützten Schlüssel aktuell mit HTTP 400 als unbekannt ab; `ALTER ROLE` wird für diesen Parameter ebenfalls abgewiesen und `ALTER SYSTEM` kann über die transaktionale Management-Verbindung nicht ausgeführt werden. Es wurde kein unsicherer Umweg erzwungen. `db_health()` meldet deshalb die Größe von `net._http_response`; beim Abschluss lag sie bei rund 1,2 MB. Die Einstellung wird nach einer Supabase-Korrektur erneut auf eine Stunde gesetzt.
- Der redundante Cron-Job wird nur anhand des geprüften Namens `cleanup-net-http-response` entfernt, nie blind anhand einer Job-ID.
- Das Supabase-Projekt läuft im Pro-Tarif weiterhin auf Nano mit 60 Datenbankverbindungen. Ein Compute-Upgrade darf keine fehlenden Schutzmechanismen verdecken.

## Rollout

### Preview

1. Erledigt: Die ersten vier Migrationen sind auf `db-stability-2026-08-14` beziehungsweise dem sauberen Testprojekt installiert. `social_global_transport` wurde danach auf dem sauberen Testprojekt validiert.
2. Erledigt: Es wurden ausschließlich synthetische Testdaten verwendet; das Testkonto wurde nach dem Lasttest wieder gelöscht.
3. Erledigt: `db-health` ist deployt, das zufällige Preview-Secret `DB_HEALTH_TOKEN` ist gesetzt, ein Aufruf ohne Token wird mit HTTP 401 abgewiesen, der zugrunde liegende Health-RPC ist grün und Better Stack bestätigt den geschützten HTTP-200-Pfad als `Up`.
4. Erledigt auf dem sauberen Testprojekt: Grants, RLS-Verträge, Maintenance und Canary-Zuordnung sind geprüft. Drei Nutzer konnten ihr eigenes privates Topic abonnieren; der Admin wurde am Topic des zweiten Nutzers mit `Unauthorized` abgewiesen. Elf Trigger erzeugten 30 Signale und deckten `dashboard`, `feed`, `groups`, `messages` und `shares` ab. Jeder Payload enthielt ausschließlich `resource` plus die von Supabase erzeugte inhaltslose Event-UUID `id`. Im Wartungsmodus erzeugten absichtlich ausgelöste Änderungen bei weiterhin offenen Test-Channels exakt null Events.
5. Erledigt: Coaching-Broadcast wurde mit drei weiteren synthetischen Nutzern geprüft. Eigene private Topics verbanden sich; ein fremdes Topic wurde mit `Unauthorized` abgewiesen. Beziehung, Nachricht, Support und Coach-Status erzeugten 12 gültige Signale ohne Nutzdaten. Der Admin-Rollback schaltete erfolgreich auf `legacy` und zurück auf `broadcast`; danach standen null Coaching-Tabellen in der Publication und `zane_coaching` wieder auf `REPLICA IDENTITY DEFAULT`.
6. Erledigt: Beide Query-Pläne verwenden den vorgesehenen Nutzerindex beziehungsweise Datumsfilter. Der Lasttest vom 14.08.2026 lief zehn Minuten mit 20 kalten Starts, fünf Social-Clients und drei Viewern: 1.142 Requests, 0 Fehler, 0 Timeouts, p95 185 ms. Alle DB-Messpunkte lagen bei 25/60 Verbindungen, ohne wartende oder länger als fünf Sekunden laufende Query.

Die Preview wurde nicht aus Produktionsdaten befüllt. Ihr erster automatischer
Aufbau meldete bereits vor den neuen Stabilitätsmigrationen Fehler, weil die
Produktions-Migrationshistorie den tatsächlich per SQL-Editor gewachsenen
Altbestand nicht vollständig beschreibt. Das war der eigentliche Grund für die
scheinbar widersprüchlichen Fehler „Spalte/Tabelle existiert bereits“ bzw. „fehlt“:
Der Branch startete mit einem Schema-Snapshot, aber einer lückenhaften Historie.

Der Supabase-Branch `offline-auth-recovery` (Projekt
`kyuwnydvvqmcqlteczyk`, datenlos) enthält jetzt die vollständige
Produktions-Historie mit 208 Einträgen:

- Die aktuelle Branch-Datenbank ist `preview_project_status = ACTIVE_HEALTHY`.
- Der Supabase-Statusdienst zeigt nach einem früheren fehlgeschlagenen
  Bootstrap weiterhin `MIGRATIONS_FAILED`, obwohl die Migrationstabelle bis
  `coaching_broadcast` reicht und der vollständige DB-Stabilitätsvertrag grün
  durchläuft. Das ist ein historischer Operationsstatus, kein aktueller
  Schemafehler.
- Die fehlenden Historieneinträge für bereits vorhandene Änderungen (u. a.
  `meal_windows`, `meal_of_choice`, `meal_of_choice_hour`, Shopping-Key und
  `food_force_grams`) wurden nur im Branch korrigiert; die zugehörigen RPCs und
  Kommentare wurden dabei ebenfalls abgeglichen.
- Nicht registrierte Altobjekte (Realtime-Stubtabellen, Food-Shopping,
  Medikamente, Rezept-Share und Reminder-Ledger) wurden im leeren Branch in den
  Produktionszustand rekonstruiert. RLS ist aktiv; die app-fremden
  `door_events`/`motion_events` sind ebenfalls in `supabase_realtime`, bleiben
  aber ohne Client-Policies und damit für Clients gesperrt.
- Alle Produktionsmigrationen und Edge Functions laufen bis zum Ende durch; der
  Build mit der Preview-URL wurde erfolgreich geprüft. Es wurden keine
  Produktionsdaten kopiert und keine Produktionsobjekte geändert.

Die Reconciliation ist jetzt auch in der Produktions-Historie verankert. Die
Produktion hatte die Objekte und ihre Publication-Zuordnung bereits; dort
wurde deshalb ausschließlich ein fehlender Eintrag in
`supabase_migrations.schema_migrations` ergänzt — keine Produktionsdaten und
keine bereits vorhandenen Tabellen wurden überschrieben.

Ergänzt wurden eine idempotente Altbestand-Baseline vor der ersten Migration,
die Publication-Zuordnung für die beiden app-fremden Eventtabellen und die
zeitlich passenden Lücken für Coaching-Threads, Tages-/Glukose-Logs,
die App-Konfiguration, Set-/Mesocycle-Felder, Rezept-Sharing, Shopping-Listen,
Medikamente, Messwerte, Reminder-Ledger und die Session-Flags. Die beiden
app-fremden Tabellen `door_events` und `motion_events` sind in der Baseline
enthalten, bleiben RLS-geschützt ohne Client-Policies und werden nicht inhaltlich
befüllt. Cron-/Secret-Migrationen wurden nicht rückwirkend ausgeführt.

Der datenlose Branch `offline-auth-recovery` wurde anschließend aus dieser
Produktions-Historie neu rebased. Die vollständige Kette läuft nun bis zur
letzten Produktionsmigration (`20260814091236 coaching_broadcast`) durch; der
DB-Stabilitätsvertrag und `db_health()` sind grün. Damit können neue
Supabase-Branches den Altbestand reproduzierbar aufbauen, statt auf einen
zufälligen Schema-Snapshot angewiesen zu sein.

Das temporäre Projekt `Zane db-stability-test` wurde nach den synthetischen
Tests gelöscht. Es verursacht daher keine weiteren Kosten.

### Produktion

Der Nutzer hat am 14.08.2026 ausdrücklich den direkten Voll-Rollout ohne gestaffelte Wartezeiten freigegeben.

1. Erledigt: Vor dem Rollout war ein tägliches physisches Produktions-Backup vorhanden. Social wurde während der Datenbankänderungen auf `maintenance` gesetzt.
2. Erledigt: `db_guardrails`, `query_load_shedding`, `social_broadcast_canary`, `db_health_client_backends`, `social_global_transport` und `coaching_broadcast` wurden auf Produktion installiert. Der vollständige DB-Stabilitätsvertrag lief dort fehlerfrei.
3. Erledigt: Client `zane-v2.789` wurde gebaut, vollständig geprüft und über den Feature-Branch veröffentlicht. Der öffentliche Service Worker liefert diese Version; ein globaler Update-Hinweis wurde ausgelöst.
4. Erledigt: Die Production-Function `db-health` ist mit eigenem Secret aktiv. Better Stack prüft sie alle drei Minuten und meldet `Up`.
5. Erledigt: Der globale Transport steht auf `broadcast` und gilt ohne E-Mail-Grant für alle aktuellen und zukünftigen Friends-Konten. `social_mode` steht auf `normal`.
6. Erledigt: Coaching, Support und Coach-Status stehen global auf `broadcast`; ihre vier Postgres-Changes-Tabellen wurden entfernt. Der Legacy-Setter kann sie atomar wiederherstellen.
7. Abschlussmessung: 23 von 60 Verbindungen, null wartende Client-Queries, null Client-Queries über fünf Sekunden und rund 1,4 MB in `net._http_response`. Seit der Umschaltung sind keine neuen Auth-, Realtime- oder `IncreaseSubscriptionConnectionPool`-Fehler sichtbar.
8. Absichtlich offen: Die neun Social-Tabellen bleiben in `supabase_realtime`, damit alte Clients und ein sofortiger Rollback weiterhin funktionieren. Entfernt werden sie erst nach eigener Freigabe, wenn die neue Client-Version ausreichend verteilt ist.

Sofort stoppen bei:

- unberechtigtem Topic-Beitritt,
- Login-Timeout,
- neuem `IncreaseSubscriptionConnectionPool`-Fehler,
- mehr als 42 belegten Verbindungen,
- mehr als 1 Prozent Requestfehlern,
- wachsender Client- oder DB-Warteschlange.

## Publication erst nach stabilem globalen Broadcast entfernen

Dieser Schritt ist absichtlich nicht Teil der installierenden Migrationen:

```sql
alter publication supabase_realtime drop table
  public.zane_social_friendships,
  public.zane_social_groups,
  public.zane_social_group_members,
  public.zane_social_messages,
  public.zane_social_message_attachments,
  public.zane_social_plan_shares,
  public.zane_social_message_reads,
  public.zane_social_plan_share_imports,
  public.zane_social_workout_comments;

alter table public.zane_social_profiles replica identity default;
alter table public.zane_social_friendships replica identity default;
alter table public.zane_social_groups replica identity default;
alter table public.zane_social_group_members replica identity default;
alter table public.zane_social_messages replica identity default;
alter table public.zane_social_message_attachments replica identity default;
alter table public.zane_social_plan_shares replica identity default;
alter table public.zane_social_message_reads replica identity default;
alter table public.zane_social_plan_share_imports replica identity default;
alter table public.zane_social_workout_comments replica identity default;
```

Rollback vor Entfernung der Publication:

1. `admin_set_social_transport('legacy')` ausführen. Alle neuen Clients wechseln sofort, die übrigen spätestens nach zwei Minuten.
2. Bei Datenbankdruck zusätzlich `admin_set_social_mode('maintenance')` ausführen.

Rollback nach bereits entfernter Publication:

1. Die neun Tabellen wieder zu `supabase_realtime` hinzufügen.
2. Die benötigten Tabellen wieder auf `REPLICA IDENTITY FULL` setzen.
3. Erst danach `admin_set_social_transport('legacy')` ausführen.

## Abnahmekriterien

- Scheduler-Tests beweisen vier Gesamt-, zwei Hintergrund- und zwei Write-Slots sowie Priorisierung.
- Zwei Druckfehler öffnen den Schutzschalter für fünf Minuten; eine fehlgeschlagene Probe verlängert auf 15 Minuten.
- Maintenance erzeugt keine Social-RPCs, Polls oder Channels.
- 20 kalte App-Starts, fünf Social-Clients und drei Live-Viewer laufen zehn Minuten auf Preview.
- Dabei höchstens 42 DB-Verbindungen, keine Login- oder DB-Timeouts und keine wachsende Warteschlange.
- Query-Pläne nutzen den neuen Set-Index und den Session-Cutoff.
- Eine Session älter als 70 Tage lädt ihre Sets weiterhin nach.
- Broadcast-Matrix deckt Freundschaft, Blockierung, Direktnachricht, Gruppe, Attachment, Lesestatus, Plan-Share und Workout-Kommentar ab.
- Ein fremder Nutzer kann kein anderes User-Topic abonnieren.
- Repo-Checks, Store-Tests, Build und Schema-/Dokumentationsprüfungen sind grün.

Wenn der Lasttest mit vier Slots scheitert, wird auf drei und danach zwei reduziert. Scheitert auch zwei, stoppt der Produktionsrollout. Compute wird nicht stillschweigend erhöht.
