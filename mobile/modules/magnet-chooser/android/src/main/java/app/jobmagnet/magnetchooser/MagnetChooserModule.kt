package app.jobmagnet.magnetchooser

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class MagnetChooserModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MagnetChooser")

    Function("arm") { path: String, filename: String, bytes: String ->
      pendingFilename = filename
      if (bytes.isNotEmpty()) {
        val dir = appContext.cacheDirectory
        val file = File(dir, filename.ifBlank { "resume.pdf" })
        file.writeBytes(Base64.decode(bytes, Base64.DEFAULT))
        pendingUri = Uri.fromFile(file)
      } else if (path.isNotEmpty()) {
        pendingUri = Uri.parse(path)
      }
      pendingUri != null
    }

    Function("pendingUri") {
      pendingUri?.toString()
    }
  }

  companion object {
    @JvmField
    var pendingUri: Uri? = null
    @JvmField
    var pendingFilename: String = "resume.pdf"

    @JvmStatic
    fun takePending(): Uri? {
      val next = pendingUri
      pendingUri = null
      return next
    }
  }
}
