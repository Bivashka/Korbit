package com.korbit.mobile;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
  private static final int MEDIA_PERMISSION_REQUEST_CODE = 901;
  private boolean mediaPermissionRequested = false;

  @Override
  protected void onStart() {
    super.onStart();
    requestMediaPermissionsIfNeeded();
  }

  private void requestMediaPermissionsIfNeeded() {
    if (mediaPermissionRequested || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return;
    }
    mediaPermissionRequested = true;

    String[] requiredPermissions = {
      Manifest.permission.CAMERA,
      Manifest.permission.RECORD_AUDIO
    };
    List<String> missingPermissions = new ArrayList<>();
    for (String permission : requiredPermissions) {
      if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
        missingPermissions.add(permission);
      }
    }

    if (!missingPermissions.isEmpty()) {
      ActivityCompat.requestPermissions(
        this,
        missingPermissions.toArray(new String[0]),
        MEDIA_PERMISSION_REQUEST_CODE
      );
    }
  }
}
