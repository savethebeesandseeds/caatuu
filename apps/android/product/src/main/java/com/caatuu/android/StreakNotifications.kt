package com.caatuu.android

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object StreakNotifications {
    const val ACTION_SHOW = "com.caatuu.android.action.STREAK_REMINDER"

    private const val PREFS = "caatuu-streak-notifications"
    private const val KEY_ASKED = "asked"
    private const val KEY_SCHEDULE = "schedule"
    private const val KEY_SHOWN = "shown"
    private const val CHANNEL_ID = "caatuu-streak-reminders"
    private const val EXTRA_TAG = "tag"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_EXPIRES_AT = "expiresAt"
    private const val MAX_REMINDERS = 2
    private const val TITLE_LIMIT = 120
    private const val BODY_LIMIT = 280
    private const val LATE_WINDOW_MS = 60L * 60L * 1000L
    private const val REQUEST_BASE = 5100
    private const val CONTENT_REQUEST = 5190
    private const val SHOWN_LIMIT = 24

    fun permission(context: Context): String {
        if (canNotify(context)) return "granted"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "denied"
        return if (prefs(context).getBoolean(KEY_ASKED, false)) "denied" else "default"
    }

    fun rememberAsked(context: Context) {
        prefs(context).edit().putBoolean(KEY_ASKED, true).apply()
    }

    fun openSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun schedule(context: Context, request: JSONObject): JSONObject {
        val reminders = parse(request)
        prefs(context).edit().putString(KEY_SCHEDULE, encode(reminders)).apply()
        return JSONObject().put("scheduled", apply(context, reminders))
    }

    fun restore(context: Context) {
        apply(context, decode(prefs(context).getString(KEY_SCHEDULE, null)))
    }

    fun showFromIntent(context: Context, intent: Intent) {
        val tag = intent.getStringExtra(EXTRA_TAG)?.trim().orEmpty()
        val title = intent.getStringExtra(EXTRA_TITLE)?.trim()?.take(TITLE_LIMIT).orEmpty()
        val body = intent.getStringExtra(EXTRA_BODY)?.trim()?.take(BODY_LIMIT).orEmpty()
        val expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0L)
        if (tag.isEmpty() || title.isEmpty() || expiresAt <= 0L) return
        show(context, Reminder(hours = 0, at = 0L, expiresAt = expiresAt, title = title, body = body, tag = tag))
    }

    private fun show(context: Context, reminder: Reminder) {
        if (reminder.expiresAt <= System.currentTimeMillis()) return
        if (!canNotify(context) || shown(context).contains(reminder.tag)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.streak_notification_channel),
            NotificationManager.IMPORTANCE_HIGH,
        )
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(reminder.title)
            .setContentText(reminder.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(reminder.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
        launchIntent(context)?.let(builder::setContentIntent)
        NotificationManagerCompat.from(context).notify(reminder.tag, 0, builder.build())
        markShown(context, reminder.tag)
    }

    private fun apply(context: Context, reminders: List<Reminder>): Int {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        cancelPending(context, alarmManager)
        val now = System.currentTimeMillis()
        val alreadyShown = shown(context)
        var armed = 0
        for (reminder in reminders) {
            if (alreadyShown.contains(reminder.tag) || reminder.expiresAt <= now) continue
            if (reminder.at > now) {
                // Inexact on purpose: a streak reminder can wait through Doze without an exact-alarm permission.
                alarmManager?.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.at, showPending(context, reminder))
                armed += 1
            } else if (now - reminder.at < LATE_WINDOW_MS) {
                show(context, reminder)
                armed += 1
            }
        }
        return armed
    }

    private fun cancelPending(context: Context, alarmManager: AlarmManager?) {
        for (hours in intArrayOf(5, 3)) {
            val pending = PendingIntent.getBroadcast(
                context,
                REQUEST_BASE + hours,
                Intent(context, StreakNotificationReceiver::class.java).setAction(ACTION_SHOW),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            ) ?: continue
            alarmManager?.cancel(pending)
            pending.cancel()
        }
    }

    private fun showPending(context: Context, reminder: Reminder): PendingIntent {
        val intent = Intent(context, StreakNotificationReceiver::class.java)
            .setAction(ACTION_SHOW)
            .putExtra(EXTRA_TAG, reminder.tag)
            .putExtra(EXTRA_TITLE, reminder.title)
            .putExtra(EXTRA_BODY, reminder.body)
            .putExtra(EXTRA_EXPIRES_AT, reminder.expiresAt)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_BASE + reminder.hours,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun launchIntent(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            CONTENT_REQUEST,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun canNotify(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun parse(request: JSONObject): List<Reminder> {
        val raw = request.optJSONArray("reminders") ?: return emptyList()
        val byHour = linkedMapOf<Int, Reminder>()
        val count = minOf(raw.length(), 8)
        for (index in 0 until count) {
            if (byHour.size >= MAX_REMINDERS) break
            val item = raw.optJSONObject(index) ?: continue
            val hours = item.optInt("hours", 0)
            if ((hours != 5 && hours != 3) || byHour.containsKey(hours)) continue
            val at = item.optLong("at", 0L)
            val expiresAt = item.optLong("expiresAtMillis", 0L)
            val title = item.optString("title").trim().take(TITLE_LIMIT)
            val body = item.optString("body").trim().take(BODY_LIMIT)
            if (at <= 0L || expiresAt <= 0L || title.isEmpty()) continue
            byHour[hours] = Reminder(hours, at, expiresAt, title, body, "$expiresAt:$hours")
        }
        return byHour.values.toList()
    }

    private fun encode(reminders: List<Reminder>): String {
        val array = JSONArray()
        for (reminder in reminders) {
            array.put(
                JSONObject()
                    .put("hours", reminder.hours)
                    .put("at", reminder.at)
                    .put("expiresAtMillis", reminder.expiresAt)
                    .put("title", reminder.title)
                    .put("body", reminder.body),
            )
        }
        return array.toString()
    }

    private fun decode(raw: String?): List<Reminder> =
        if (raw.isNullOrBlank()) {
            emptyList()
        } else {
            runCatching { parse(JSONObject().put("reminders", JSONArray(raw))) }.getOrDefault(emptyList())
        }

    private fun shown(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_SHOWN, emptySet())?.toSet() ?: emptySet()

    private fun markShown(context: Context, tag: String) {
        val next = shown(context).toMutableSet()
        next.add(tag)
        while (next.size > SHOWN_LIMIT) next.remove(next.first())
        prefs(context).edit().putStringSet(KEY_SHOWN, next).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private data class Reminder(
        val hours: Int,
        val at: Long,
        val expiresAt: Long,
        val title: String,
        val body: String,
        val tag: String,
    )
}
