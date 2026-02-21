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

  @Override
  public void onStart() {
    super.onStart();
    requestMediaPermissionsIfNeeded();
  }

  @Override
  public void onResume() {
    super.onResume();
    requestMediaPermissionsIfNeeded();
  }

  private void requestMediaPermissionsIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return;
    }

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
