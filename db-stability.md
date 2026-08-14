# Datenbank-Stabilität: Postmortem und Notfallhandbuch

Stand: 14.08.2026

Status: Der Produktionsrollout ist abgeschlossen. Client `zane-v2.785`, alle fünf Stabilitätsmigrationen, `db-health`, Better Stack und globaler Broadcast für alle aktuellen und zukünftigen Friends-Konten sind aktiv. SQL-Verträge, Query-Pläne, Maintenance-/Broadcast-Schaltung, der zehnminütige HTTP-Lasttest und der echte private Broadcast-WebSocket-Test sind grün. Die alte Social-Publication bleibt zunächst als sofortiger Rückweg bestehen.

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

`zane_app_config.social_mode` kennt `normal` und `maintenance`. `zane_app_config.social_transport` kennt `broadcast` und `legacy`.

- `admin_set_social_mode(p_mode)` ist nur für `office@btc-prime.biz` ausführbar.
- `admin_set_social_transport(p_transport)` ist der globale Broadcast-Rollback und ebenfalls nur für die Admin-Adresse ausführbar.
- `get_runtime_config()` liefert Update-Nonce, Social-Modus und den globalen Transport.
- Neue Clients zeigen im Wartungsmodus eine Wartungsseite und starten keine Social-RPCs, Polls oder Channels.
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

`social_transport = 'broadcast'` gilt automatisch für jeden aktuellen und zukünftigen Friends-Nutzer. `legacy` schaltet alle Clients spätestens beim nächsten zweiminütigen Runtime-Config-Abruf auf Postgres Changes zurück. Die alte Publication bleibt als sofortiger Rückweg aktiv. Coaching, `door_events` und `motion_events` werden nicht verändert.

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
5. Erledigt: Beide Query-Pläne verwenden den vorgesehenen Nutzerindex beziehungsweise Datumsfilter. Der Lasttest vom 14.08.2026 lief zehn Minuten mit 20 kalten Starts, fünf Social-Clients und drei Viewern: 1.142 Requests, 0 Fehler, 0 Timeouts, p95 185 ms. Alle DB-Messpunkte lagen bei 25/60 Verbindungen, ohne wartende oder länger als fünf Sekunden laufende Query.

Die Preview wurde nicht aus Produktionsdaten befüllt. Ihr automatischer Aufbau meldete bereits vor den neuen Stabilitätsmigrationen einen Fehler, weil die registrierte Produktions-Migrationshistorie nicht den vollständigen Altbestand enthält. Für die isolierten Tests wurde deshalb der versionierte Schema-Snapshot eingespielt. Dieser Baseline-Fehler muss separat korrigiert werden, bevor Preview-Branches als vollständiger Realtime-Rollout-Gate dienen können.

Das temporäre Projekt `Zane db-stability-test` wurde am 14.08.2026 ausdrücklich für 10 USD/Monat angelegt und ebenfalls ausschließlich mit synthetischen Daten befüllt. Beim abschließenden Health-Test wurde ein Fehlalarm entdeckt: Supabases normaler Realtime-WAL-Sender wartet dauerhaft auf neue WAL-Daten. Migration `20260814072030_db_health_client_backends` begrenzt Warte-/Langläufer-Alarme deshalb auf echte `client backend`-Queries. Danach meldete `db_health()` 8/60 Verbindungen, 0 wartende Client-Queries und 0 Langläufer. Die drei synthetischen Auth-Nutzer und ihre kaskadierenden Social-Daten wurden nach dem Test gelöscht; `social_mode` steht wieder auf `normal`. Das Projekt selbst bleibt für die Produktionsvorbereitung bestehen und verursacht bis zum Löschen weiterhin 10 USD/Monat.

### Produktion

Der Nutzer hat am 14.08.2026 ausdrücklich den direkten Voll-Rollout ohne gestaffelte Wartezeiten freigegeben.

1. Erledigt: Vor dem Rollout war ein tägliches physisches Produktions-Backup vorhanden. Social wurde während der Datenbankänderungen auf `maintenance` gesetzt.
2. Erledigt: `db_guardrails`, `query_load_shedding`, `social_broadcast_canary`, `db_health_client_backends` und `social_global_transport` wurden auf Produktion installiert. Der vollständige DB-Stabilitätsvertrag lief dort fehlerfrei.
3. Erledigt: Client `zane-v2.785` wurde gebaut und vollständig lokal geprüft. Die Veröffentlichung wird über den Feature-Branch ausgelöst.
4. Erledigt: Die Production-Function `db-health` ist mit eigenem Secret aktiv. Better Stack prüft sie alle drei Minuten und meldet `Up`.
5. Erledigt: Der globale Transport steht auf `broadcast` und gilt ohne E-Mail-Grant für alle aktuellen und zukünftigen Friends-Konten. `social_mode` steht auf `normal`.
6. Abschlussmessung: 23 von 60 Verbindungen, null wartende Client-Queries, null Client-Queries über fünf Sekunden und rund 1,2 MB in `net._http_response`. Seit dem Rollout sind keine neuen Realtime-Timeouts oder `IncreaseSubscriptionConnectionPool`-Fehler sichtbar.
7. Absichtlich offen: Die neun Social-Tabellen bleiben in `supabase_realtime`, damit alte Clients und ein sofortiger Rollback weiterhin funktionieren. Entfernt werden sie erst nach eigener Freigabe, wenn die neue Client-Version ausreichend verteilt ist.

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
