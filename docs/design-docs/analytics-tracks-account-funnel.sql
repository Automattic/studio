-- Trino / Superset draft. Aggregate output only; not yet executed against the warehouse.
-- Replace the version filter with the first release containing the account-funnel events.
-- Keep channel/version/placement/intent separate. Identity represents an installation.
WITH candidate_events AS (
    SELECT
        userid,
        eventname,
        ts,
        element_at(eventprops, 'channel') AS channel,
        element_at(eventprops, 'app_version') AS app_version,
        element_at(eventprops, 'placement') AS placement,
        element_at(eventprops, 'intent') AS intent,
        element_at(eventprops, 'auth_flow') AS auth_flow,
        element_at(eventprops, 'auth_attempt_id') AS attempt_id,
        element_at(eventprops, 'journey_id') AS journey_id,
        element_at(eventprops, 'success') AS success,
        element_at(eventprops, 'is_a11n') AS is_a11n
    FROM tracks.prod_events
    WHERE dateymd >= CAST(date_format(current_date - INTERVAL '16' DAY, '%Y%m%d') AS INTEGER)
      AND dateymd <= CAST(date_format(current_date, '%Y%m%d') AS INTEGER)
      AND ts <= to_unixtime(current_timestamp) * 1000
      AND useridtype = 'anon'
      AND element_at(eventprops, 'app_version') = 'REPLACE_WITH_RELEASE_VERSION'
      AND eventname IN (
          'studio_account_prompt_viewed', 'studio_wpcom_auth_started', 'studio_wpcom_auth',
          'studio_wpcom_auth_cancelled', 'studio_wpcom_auth_launch_failed',
          'studio_account_journey_completed'
      )
), events AS (
    SELECT e.* FROM candidate_events e
    WHERE e.is_a11n = 'false'
      AND NOT EXISTS (
          SELECT 1 FROM candidate_events staff
          WHERE staff.userid = e.userid AND staff.is_a11n = 'true'
      )
), starts AS (
    SELECT userid, channel, app_version, placement, intent, auth_flow, attempt_id, journey_id,
           MIN(ts) AS started_at
    FROM events
    WHERE eventname = 'studio_wpcom_auth_started' AND attempt_id IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
), observed AS (
    SELECT s.userid, s.channel, s.app_version, s.placement, s.intent, s.auth_flow,
           s.attempt_id, s.journey_id, s.started_at,
           MIN(o.ts) FILTER (WHERE o.eventname = 'studio_wpcom_auth' AND o.success = 'true') AS succeeded_at,
           COUNT_IF(o.eventname = 'studio_wpcom_auth' AND o.success = 'false') > 0 AS failed,
           COUNT_IF(o.eventname = 'studio_wpcom_auth_cancelled') > 0 AS cancelled,
           COUNT_IF(o.eventname = 'studio_wpcom_auth_launch_failed') > 0 AS launch_failed
    FROM starts s
    LEFT JOIN events o
      ON o.userid = s.userid AND o.channel = s.channel AND o.attempt_id = s.attempt_id
     AND o.ts >= s.started_at AND o.ts <= s.started_at + 86400000
    WHERE s.started_at >= to_unixtime(current_timestamp - INTERVAL '14' DAY) * 1000
      AND s.started_at <= to_unixtime(current_timestamp - INTERVAL '24' HOUR) * 1000
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
), prompt_journeys AS (
    SELECT userid, channel, app_version, placement, intent, journey_id, MIN(ts) AS viewed_at
    FROM events
    WHERE eventname = 'studio_account_prompt_viewed' AND journey_id IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6
), prompt_results AS (
    SELECT p.userid, p.channel, p.app_version, p.placement, p.intent, p.journey_id,
           COUNT(s.attempt_id) > 0 AS started
    FROM prompt_journeys p
    LEFT JOIN starts s
      ON s.userid = p.userid AND s.channel = p.channel AND s.journey_id = p.journey_id
     AND s.placement = p.placement AND s.intent = p.intent
     AND s.started_at >= p.viewed_at AND s.started_at <= p.viewed_at + 86400000
    WHERE p.viewed_at >= to_unixtime(current_timestamp - INTERVAL '14' DAY) * 1000
      AND p.viewed_at <= to_unixtime(current_timestamp - INTERVAL '24' HOUR) * 1000
    GROUP BY 1, 2, 3, 4, 5, 6
), successful_journeys AS (
    SELECT userid, channel, app_version, placement, intent, journey_id,
           MIN(succeeded_at) AS succeeded_at
    FROM observed
    WHERE succeeded_at IS NOT NULL AND journey_id IS NOT NULL
      AND intent IN ('build', 'annotate', 'share', 'publish', 'connect_site')
    GROUP BY 1, 2, 3, 4, 5, 6
), task_results AS (
    SELECT s.userid, s.channel, s.app_version, s.placement, s.intent, s.journey_id,
           COUNT(e.ts) > 0 AS completed
    FROM successful_journeys s
    LEFT JOIN events e
      ON e.userid = s.userid AND e.channel = s.channel AND e.journey_id = s.journey_id
     AND e.intent = s.intent AND e.eventname = 'studio_account_journey_completed'
     AND e.ts >= s.succeeded_at AND e.ts <= s.succeeded_at + 86400000
    WHERE s.succeeded_at <= to_unixtime(current_timestamp - INTERVAL '24' HOUR) * 1000
    GROUP BY 1, 2, 3, 4, 5, 6
), metrics AS (
    SELECT channel, app_version, placement, intent, 'all' AS auth_flow,
           'prompt_journeys_starting_auth_24h' AS metric,
           COUNT_IF(started) AS numerator, COUNT(*) AS denominator
    FROM prompt_results GROUP BY 1, 2, 3, 4
    UNION ALL
    SELECT channel, app_version, placement, intent, auth_flow,
           'attempts_succeeding_24h', COUNT_IF(succeeded_at IS NOT NULL), COUNT(*)
    FROM observed GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT channel, app_version, placement, intent, auth_flow,
           'attempts_returning_failure_24h', COUNT_IF(succeeded_at IS NULL AND failed), COUNT(*)
    FROM observed GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT channel, app_version, placement, intent, auth_flow,
           'attempts_cancelled_24h', COUNT_IF(succeeded_at IS NULL AND NOT failed AND cancelled), COUNT(*)
    FROM observed GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT channel, app_version, placement, intent, auth_flow,
           'attempts_with_no_observed_terminal_outcome_24h',
           COUNT_IF(succeeded_at IS NULL AND NOT failed AND NOT cancelled), COUNT(*)
    FROM observed GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT channel, app_version, placement, intent, auth_flow,
           'attempts_with_handoff_failure_24h', COUNT_IF(launch_failed), COUNT(*)
    FROM observed GROUP BY 1, 2, 3, 4, 5
    UNION ALL
    SELECT channel, app_version, placement, intent, 'all',
           'successful_auth_journeys_completing_task_24h', COUNT_IF(completed), COUNT(*)
    FROM task_results GROUP BY 1, 2, 3, 4
)
SELECT channel, app_version, placement, intent, auth_flow, metric, numerator, denominator,
       CAST(numerator AS DOUBLE) / NULLIF(denominator, 0) AS rate
FROM metrics
ORDER BY channel, app_version, placement, intent, auth_flow, metric;
