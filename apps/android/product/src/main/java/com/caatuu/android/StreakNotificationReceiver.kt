package com.caatuu.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class StreakNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> StreakNotifications.restore(context)
            StreakNotifications.ACTION_SHOW -> StreakNotifications.showFromIntent(context, intent)
        }
    }
}
