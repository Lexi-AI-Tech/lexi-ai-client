//! Windows: match `focused_app` against running processes → exe icon via Shell / GDI → PNG data URL.

use std::ffi::{OsStr, OsString};
use std::mem;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use base64::Engine;
use png::{BitDepth, ColorType, Encoder};
use winapi::ctypes::c_void;
use winapi::shared::minwindef::{FALSE, UINT};
use winapi::shared::windef::{HBITMAP, HICON};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::OpenProcess;
use winapi::um::shellapi::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use winapi::um::winbase::QueryFullProcessImageNameW;
use winapi::um::wingdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use winapi::um::winnt::{LPCWSTR, PROCESS_QUERY_LIMITED_INFORMATION};
use winapi::um::winuser::{
    DestroyIcon, DrawIconEx, GetDC, GetSystemMetrics, ReleaseDC, SM_CXICON, SM_CYICON,
};
use winapi::um::winver::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

const DI_NORMAL: UINT = 0x0003;

#[repr(C)]
struct LangCodePage {
    w_language: u16,
    w_code_page: u16,
}

fn to_wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn file_description(path: &Path) -> Option<String> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let path_ptr = wide.as_ptr();

    let info_size = unsafe { GetFileVersionInfoSizeW(path_ptr as LPCWSTR, std::ptr::null_mut()) };
    if info_size == 0 {
        return None;
    }
    let mut buf = vec![0u8; info_size as usize];
    if unsafe { GetFileVersionInfoW(path_ptr as LPCWSTR, 0, info_size, buf.as_mut_ptr().cast()) }
        == FALSE
    {
        return None;
    }

    let translation: Vec<u16> = OsStr::new("\\VarFileInfo\\Translation")
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut lang_ptr: *mut c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    if unsafe {
        VerQueryValueW(
            buf.as_ptr().cast(),
            translation.as_ptr(),
            &mut lang_ptr,
            &mut len,
        )
    } == FALSE
        || lang_ptr.is_null()
        || len < mem::size_of::<LangCodePage>() as u32
    {
        return None;
    }

    let lang = unsafe { &*(lang_ptr as *const LangCodePage) };
    let subblock = format!(
        "\\StringFileInfo\\{:04x}{:04x}\\FileDescription",
        lang.w_language, lang.w_code_page
    );
    let subblock_w: Vec<u16> = OsString::from(subblock)
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut desc_ptr: *mut c_void = std::ptr::null_mut();
    let mut desc_len: u32 = 0;
    if unsafe {
        VerQueryValueW(
            buf.as_ptr().cast(),
            subblock_w.as_ptr(),
            &mut desc_ptr,
            &mut desc_len,
        )
    } == FALSE
        || desc_ptr.is_null()
        || desc_len < 2
    {
        return None;
    }

    let wchar_count = (desc_len as usize / 2).saturating_sub(1);
    let slice = unsafe { std::slice::from_raw_parts(desc_ptr as *const u16, wchar_count) };
    let s = String::from_utf16_lossy(slice);
    let trimmed = s.trim_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn process_display_name(path: &Path) -> String {
    if let Some(fd) = file_description(path) {
        return fd;
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_owned()
}

fn exe_file_name_lower(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn exe_stem_lower(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn path_matches_focused_app(path: &Path, query: &str) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return false;
    }

    if query.contains('\\') || query.contains('/') {
        if Path::new(query) == path {
            return true;
        }
    }

    let disp = process_display_name(path);
    let disp_l = disp.to_lowercase();
    let q_l = query.to_lowercase();
    let stem_l = exe_stem_lower(path);
    let fname_l = exe_file_name_lower(path);

    if disp.eq_ignore_ascii_case(query)
        || stem_l == q_l
        || fname_l == q_l
        || fname_l == format!("{q_l}.exe")
    {
        return true;
    }

    disp_l.contains(&q_l) || q_l.contains(&disp_l) || stem_l.contains(&q_l) || q_l.contains(&stem_l)
}

fn image_path_for_pid(pid: u32) -> Option<PathBuf> {
    if pid == 0 {
        return None;
    }
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
    if h.is_null() {
        return None;
    }

    let mut buf = vec![0u16; 32768];
    let mut size = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut size) };
    unsafe { CloseHandle(h) };
    if ok == FALSE || size == 0 {
        return None;
    }

    let path = OsString::from_wide(&buf[..size as usize]);
    let p = PathBuf::from(path);
    if p.as_os_str().is_empty() {
        None
    } else {
        Some(p)
    }
}

fn find_exe_for_app_name(app_name: &str) -> Option<PathBuf> {
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut best_weak: Option<PathBuf> = None;

    unsafe {
        let mut entry: PROCESSENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut entry) == FALSE {
            CloseHandle(snap);
            return None;
        }

        loop {
            let pid = entry.th32ProcessID;
            if let Some(path) = image_path_for_pid(pid) {
                if path_matches_focused_app(&path, app_name) {
                    let disp = process_display_name(&path);
                    if disp.eq_ignore_ascii_case(app_name.trim())
                        || exe_stem_lower(&path) == app_name.trim().to_lowercase()
                        || exe_file_name_lower(&path) == app_name.trim().to_lowercase()
                    {
                        CloseHandle(snap);
                        return Some(path);
                    }
                    if best_weak.is_none() {
                        best_weak = Some(path);
                    }
                }
            }

            if Process32NextW(snap, &mut entry) == FALSE {
                break;
            }
        }

        CloseHandle(snap);
    }

    best_weak
}

unsafe fn hicon_to_png_data_url(hicon: HICON) -> Option<String> {
    let screen = GetDC(std::ptr::null_mut());
    if screen.is_null() {
        return None;
    }
    let mem_dc = CreateCompatibleDC(screen);
    if mem_dc.is_null() {
        ReleaseDC(std::ptr::null_mut(), screen);
        return None;
    }

    let cx = GetSystemMetrics(SM_CXICON);
    let cy = GetSystemMetrics(SM_CYICON);
    if cx <= 0 || cy <= 0 {
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen);
        return None;
    }

    let mut bmi: BITMAPINFO = mem::zeroed();
    bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = cx;
    bmi.bmiHeader.biHeight = -cy;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    let mut bits: *mut c_void = std::ptr::null_mut();
    let hbm: HBITMAP = CreateDIBSection(
        mem_dc,
        &bmi,
        DIB_RGB_COLORS,
        &mut bits,
        std::ptr::null_mut(),
        0,
    );
    if hbm.is_null() || bits.is_null() {
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen);
        return None;
    }

    let old = SelectObject(mem_dc, hbm as _);
    DrawIconEx(
        mem_dc,
        0,
        0,
        hicon,
        cx,
        cy,
        0,
        std::ptr::null_mut(),
        DI_NORMAL,
    );
    SelectObject(mem_dc, old);

    let w = cx as u32;
    let h = cy as u32;
    let row = (w * 4) as usize;
    let total = row * h as usize;
    let src = std::slice::from_raw_parts(bits as *const u8, total);
    let mut rgba = Vec::with_capacity(total);
    for y in 0..h as usize {
        let row_off = y * row;
        for x in 0..w as usize {
            let i = row_off + x * 4;
            rgba.push(src[i + 2]);
            rgba.push(src[i + 1]);
            rgba.push(src[i + 0]);
            rgba.push(src[i + 3]);
        }
    }

    DeleteObject(hbm as _);
    DeleteDC(mem_dc);
    ReleaseDC(std::ptr::null_mut(), screen);

    let mut png_bytes = Vec::new();
    {
        let mut enc = Encoder::new(&mut png_bytes, w, h);
        enc.set_color(ColorType::Rgba);
        enc.set_depth(BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

fn icon_data_url_for_exe(path: &Path) -> Option<String> {
    let wide = to_wide_path(path);
    let mut shfi: SHFILEINFOW = unsafe { mem::zeroed() };
    let flags = SHGFI_ICON | SHGFI_LARGEICON;
    unsafe {
        SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut shfi,
            mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        )
    };
    if shfi.hIcon.is_null() {
        return None;
    }

    let url = unsafe { hicon_to_png_data_url(shfi.hIcon) };
    unsafe {
        DestroyIcon(shfi.hIcon);
    }

    url
}

pub(super) fn get_app_icon_data_url(app_name: &str) -> Option<String> {
    if app_name.is_empty() {
        return None;
    }
    let path = find_exe_for_app_name(app_name)?;
    icon_data_url_for_exe(&path)
}
