// Native document back-end: PDF text layer (Poppler C++), OCR (Tesseract C++ API),
// and OCR of scanned PDF pages (Poppler renderer -> Tesseract), all in-process.
//
// Why a native back-end: Tesseract and Poppler are C++ libraries. Calling them
// directly avoids spawning one `tesseract` process per page (what pytesseract
// does) and avoids Python-level loops over glyphs (what pure-Python PDF parsers
// do). Pages are independent, so scanned PDFs are OCR'd with one Tesseract
// instance per std::thread (instances are not thread-safe; one per thread is
// the documented pattern). The thread count is chosen in Python from the
// hardware probe.
//
// Output: one UTF-8 string per call, pages separated by '\f' (form feed), the
// same convention as `pdftotext`. The caller frees it with de_free().
//
// Build: python -m data_engine.accel.build   (needs poppler-cpp + tesseract dev packages)

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-image.h>
#include <poppler/cpp/poppler-page-renderer.h>
#include <poppler/cpp/poppler-page.h>
#include <tesseract/baseapi.h>
#include <leptonica/allheaders.h>

#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define EXPORT extern "C" __declspec(dllexport)
#else
#define EXPORT extern "C"
#endif

static char* dup_string(const std::string& s) {
    char* out = static_cast<char*>(std::malloc(s.size() + 1));
    if (out) std::memcpy(out, s.c_str(), s.size() + 1);
    return out;
}

EXPORT void de_free(char* p) { std::free(p); }

// Number of pages, or -1 if the file cannot be opened.
EXPORT int de_pdf_pages(const char* path) {
    std::unique_ptr<poppler::document> doc(poppler::document::load_from_file(path));
    return doc ? doc->pages() : -1;
}

// Text layer of every page (no OCR). Returns NULL if the PDF cannot be opened.
EXPORT char* de_pdf_text(const char* path) {
    std::unique_ptr<poppler::document> doc(poppler::document::load_from_file(path));
    if (!doc || doc->is_locked()) return nullptr;
    std::string all;
    for (int i = 0; i < doc->pages(); ++i) {
        std::unique_ptr<poppler::page> page(doc->create_page(i));
        if (page) {
            poppler::byte_array utf8 = page->text().to_utf8();
            all.append(utf8.begin(), utf8.end());
        }
        all.push_back('\f');
    }
    return dup_string(all);
}

// OCR one image file (PNG/JPEG/TIFF...). mean_conf receives Tesseract's mean word confidence.
EXPORT char* de_ocr_image(const char* path, const char* lang, int* mean_conf) {
    tesseract::TessBaseAPI api;
    if (api.Init(nullptr, lang)) return nullptr;
    Pix* image = pixRead(path);
    if (!image) { api.End(); return nullptr; }
    api.SetImage(image);
    char* text = api.GetUTF8Text();
    if (mean_conf) *mean_conf = api.MeanTextConf();
    std::string out = text ? text : "";
    delete[] text;
    pixDestroy(&image);
    api.End();
    return dup_string(out);
}

// Render + OCR every page of a (scanned) PDF, pages split across n_threads threads.
EXPORT char* de_pdf_ocr(const char* path, const char* lang, int dpi, int n_threads, int* mean_conf) {
    std::unique_ptr<poppler::document> probe(poppler::document::load_from_file(path));
    if (!probe) return nullptr;
    const int n_pages = probe->pages();
    probe.reset();
    if (n_threads < 1) n_threads = 1;
    if (n_threads > n_pages) n_threads = n_pages > 0 ? n_pages : 1;

    std::vector<std::string> texts(n_pages);
    std::vector<int> confs(n_pages, 0);
    auto worker = [&](int first, int step) {
        // Each thread owns its document handle and its Tesseract instance.
        std::unique_ptr<poppler::document> doc(poppler::document::load_from_file(path));
        tesseract::TessBaseAPI api;
        if (!doc || api.Init(nullptr, lang)) return;
        poppler::page_renderer renderer;
        renderer.set_render_hint(poppler::page_renderer::antialiasing, true);
        renderer.set_render_hint(poppler::page_renderer::text_antialiasing, true);
        for (int i = first; i < n_pages; i += step) {
            std::unique_ptr<poppler::page> page(doc->create_page(i));
            if (!page) continue;
            poppler::image img = renderer.render_page(page.get(), dpi, dpi);
            if (!img.is_valid()) continue;
            // ARGB32 rows: 4 bytes per pixel, bytes_per_row stride.
            api.SetImage(reinterpret_cast<const unsigned char*>(img.const_data()), img.width(), img.height(), 4,
                         img.bytes_per_row());
            api.SetSourceResolution(dpi);
            char* text = api.GetUTF8Text();
            texts[i] = text ? text : "";
            confs[i] = api.MeanTextConf();
            delete[] text;
        }
        api.End();
    };
    std::vector<std::thread> pool;
    for (int t = 0; t < n_threads; ++t) pool.emplace_back(worker, t, n_threads);
    for (auto& th : pool) th.join();

    std::string all;
    long conf_sum = 0;
    for (int i = 0; i < n_pages; ++i) {
        all += texts[i];
        all.push_back('\f');
        conf_sum += confs[i];
    }
    if (mean_conf) *mean_conf = n_pages ? static_cast<int>(conf_sum / n_pages) : 0;
    return dup_string(all);
}
