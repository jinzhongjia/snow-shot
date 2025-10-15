use enigo::{Axis, Mouse};
use futures::stream::StreamExt;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use tauri::Manager;
use tokio::{fs, sync::Mutex, time};

use snow_shot_app_os::notification;
use snow_shot_app_services::{
    free_drag_window_service::FreeDragWindowService,
    hot_load_page_service::HotLoadPageRoutePushEvent, resize_window_service::ResizeWindowSide,
};
use snow_shot_app_services::{
    hot_load_page_service::HotLoadPageService, resize_window_service::ResizeWindowService,
};
use snow_shot_app_shared::{ElementRect, EnigoManager};
use snow_shot_app_utils::{get_target_monitor, monitor_info::MonitorRect};

pub async fn exit_app(handle: tauri::AppHandle) {
    handle.exit(0);
}

pub async fn get_selected_text() -> String {
    let text = match get_selected_text::get_selected_text() {
        Ok(text) => text,
        Err(_) => {
            return String::new();
        }
    };
    text
}

pub async fn set_enable_proxy(enable: bool, host: String) -> Result<(), ()> {
    unsafe {
        if enable {
            std::env::set_var("NO_PROXY", "");
        } else {
            std::env::set_var("NO_PROXY", host);
        }
    }
    Ok(())
}

/// 鼠标滚轮穿透
pub async fn scroll_through(
    window: tauri::Window,
    enigo_manager: tauri::State<'_, Mutex<EnigoManager>>,
    length: i32,
) -> Result<(), String> {
    let mut enigo = enigo_manager.lock().await;
    let enigo = enigo.get_enigo()?;

    let result = window.set_ignore_cursor_events(true);
    if result.is_err() {
        return Err(String::from(
            "[scroll_through] Failed to set ignore cursor events",
        ));
    }

    time::sleep(time::Duration::from_millis(10)).await;

    {
        match enigo.scroll(length, Axis::Vertical) {
            Ok(_) => (),
            Err(e) => {
                log::error!("[scroll_through] scroll error: {}", e);
            }
        }
    }

    time::sleep(time::Duration::from_millis(128)).await;
    let _ = window.set_ignore_cursor_events(false);

    Ok(())
}

pub async fn auto_scroll_through(
    enigo_manager: tauri::State<'_, Mutex<EnigoManager>>,
    direction: String,
    length: i32,
) -> Result<(), String> {
    let mut enigo = enigo_manager.lock().await;
    let enigo = enigo.get_enigo()?;

    {
        match enigo.scroll(
            length,
            match direction.as_str() {
                "vertical" => Axis::Vertical,
                "horizontal" => Axis::Horizontal,
                _ => {
                    return Err(String::from("[auto_scroll_through] Invalid direction"));
                }
            },
        ) {
            Ok(_) => (),
            Err(e) => {
                log::error!("[auto_scroll_through] scroll error: {}", e);
            }
        }
    }

    Ok(())
}

/// 鼠标滚轮穿透
pub async fn click_through(window: tauri::Window) -> Result<(), ()> {
    let result = window.set_ignore_cursor_events(true);
    if result.is_err() {
        return Ok(());
    }

    time::sleep(time::Duration::from_millis(300)).await;
    match window.set_ignore_cursor_events(false) {
        Ok(_) => (),
        Err(_) => (),
    }

    Ok(())
}

/// 创建内容固定到屏幕的窗口
pub async fn create_fixed_content_window(
    app: tauri::AppHandle,
    hot_load_page_service: tauri::State<'_, Arc<HotLoadPageService>>,
    scroll_screenshot: bool,
) -> Result<(), String> {
    let (_, _, monitor) = get_target_monitor()?;

    let monitor_x = monitor.x().unwrap() as f64;
    let monitor_y = monitor.y().unwrap() as f64;

    let window_x;
    let window_y;
    #[cfg(target_os = "macos")]
    {
        window_x = monitor_x;
        window_y = monitor_y;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let monitor_scale_factor = monitor.scale_factor().unwrap() as f64;
        window_x = monitor_x / monitor_scale_factor;
        window_y = monitor_y / monitor_scale_factor;
    }

    let url = format!("/fixedContent?scroll_screenshot={}", scroll_screenshot);

    if let Some(window) = hot_load_page_service.pop_page().await {
        window.set_always_on_top(true).unwrap();
        window
            .set_size(tauri::PhysicalSize::new(500.0, 500.0))
            .unwrap();

        match window.emit(
            "hot-load-page-route-push",
            HotLoadPageRoutePushEvent {
                label: window.label().to_owned(),
                url,
            },
        ) {
            Ok(_) => (),
            Err(e) => {
                log::error!("[create_fixed_content_window] Failed to emit event: {}", e);
            }
        }

        match hot_load_page_service.create_idle_windows().await {
            Ok(_) => (),
            Err(e) => {
                log::error!(
                    "[create_fixed_content_window] Failed to create idle windows: {}",
                    e
                );
            }
        }

        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        format!(
            "fixed-content-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
        ),
        tauri::WebviewUrl::App(PathBuf::from(url)),
    )
    .always_on_top(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .fullscreen(false)
    .title("Snow Shot - Fixed Content")
    .position(window_x, window_y)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .inner_size(500.0, 500.0)
    .position(0.0, 0.0)
    .build()
    .unwrap();

    window.hide().unwrap();
    window.center().unwrap();

    Ok(())
}

pub struct FullScreenDrawWindowLabels {
    full_screen_draw_window_label: String,
    switch_mouse_through_window_label: String,
}

/// 创建全屏绘制窗口
pub async fn create_full_screen_draw_window(
    app: tauri::AppHandle,
    full_screen_draw_window_labels: tauri::State<'_, Mutex<Option<FullScreenDrawWindowLabels>>>,
    hot_load_page_service: tauri::State<'_, Arc<HotLoadPageService>>,
) -> Result<(), String> {
    let mut full_screen_draw_window_labels = full_screen_draw_window_labels.lock().await;

    if let Some(labels) = full_screen_draw_window_labels.as_ref() {
        // 发送改变鼠标穿透的消息
        app.get_webview_window(labels.full_screen_draw_window_label.as_str())
            .unwrap()
            .emit("full-screen-draw-change-mouse-through", ())
            .unwrap();

        return Ok(());
    }

    let (_, _, monitor) = get_target_monitor()?;

    let monitor_x = monitor.x().unwrap() as f64;
    let monitor_y = monitor.y().unwrap() as f64;
    let monitor_width = monitor.width().unwrap() as f64;
    let monitor_height = monitor.height().unwrap() as f64;

    // 先从服务中获取两个窗口（必须串行以避免竞态条件）
    let main_window_opt = hot_load_page_service.pop_page().await;
    let switch_window_opt = hot_load_page_service.pop_page().await;

    let has_hot_load = main_window_opt.is_some() || switch_window_opt.is_some();

    let main_window_url = format!("/fullScreenDraw");
    let switch_mouse_through_window_url = format!(
        "/fullScreenDraw/switchMouseThrough?monitor_x={}&monitor_y={}&monitor_width={}&monitor_height={}",
        monitor_x, monitor_y, monitor_width, monitor_height
    );

    // 并行创建/配置两个窗口
    let (main_window, switch_mouse_through_window) = tokio::join!(
        async {
            match main_window_opt {
                Some(window) => {
                    window.set_always_on_top(true).unwrap();
                    window.set_title("Snow Shot - Full Screen Draw").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();

                    match window.emit(
                        "hot-load-page-route-push",
                        HotLoadPageRoutePushEvent {
                            label: window.label().to_owned(),
                            url: main_window_url.clone(),
                        },
                    ) {
                        Ok(_) => (),
                        Err(e) => {
                            log::error!(
                                "[create_full_screen_draw_window] Failed to emit event: {}",
                                e
                            );
                        }
                    }

                    window
                }
                None => tauri::WebviewWindowBuilder::new(
                    &app,
                    format!("full-screen-draw"),
                    tauri::WebviewUrl::App(PathBuf::from(main_window_url.clone())),
                )
                .always_on_top(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .title("Snow Shot - Full Screen Draw")
                .position(0.0, 0.0)
                .inner_size(1.0, 1.0)
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(true)
                .build()
                .unwrap(),
            }
        },
        async {
            match switch_window_opt {
                Some(window) => {
                    window.set_always_on_top(true).unwrap();
                    window
                        .set_title("Snow Shot - Full Screen Draw - Switch Mouse Through")
                        .unwrap();
                    window.show().unwrap();

                    match window.emit(
                        "hot-load-page-route-push",
                        HotLoadPageRoutePushEvent {
                            label: window.label().to_owned(),
                            url: switch_mouse_through_window_url.clone(),
                        },
                    ) {
                        Ok(_) => (),
                        Err(e) => {
                            log::error!(
                                "[create_full_screen_draw_window] Failed to emit event: {}",
                                e
                            );
                        }
                    }

                    window
                }
                None => tauri::WebviewWindowBuilder::new(
                    &app,
                    format!("full-screen-draw-switch-mouse-through"),
                    tauri::WebviewUrl::App(PathBuf::from(switch_mouse_through_window_url.clone())),
                )
                .always_on_top(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .title("Snow Shot - Full Screen Draw - Switch Mouse Through")
                .position(0.0, 0.0)
                .inner_size(1.0, 1.0)
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .skip_taskbar(true)
                .resizable(false)
                .build()
                .unwrap(),
            }
        }
    );

    #[cfg(target_os = "macos")]
    {
        main_window
            .set_position(tauri::LogicalPosition::new(monitor_x, monitor_y))
            .unwrap();
        main_window
            .set_size(tauri::LogicalSize::new(monitor_width, monitor_height))
            .unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    {
        main_window
            .set_position(tauri::PhysicalPosition::new(monitor_x, monitor_y))
            .unwrap();
        main_window
            .set_size(tauri::PhysicalSize::new(monitor_width, monitor_height))
            .unwrap();
    }

    if has_hot_load {
        match hot_load_page_service.create_idle_windows().await {
            Ok(_) => (),
            Err(e) => {
                log::error!(
                    "[create_full_screen_draw_window] Failed to create idle windows: {}",
                    e
                );
            }
        }
    }

    *full_screen_draw_window_labels = Some(FullScreenDrawWindowLabels {
        full_screen_draw_window_label: main_window.label().to_owned(),
        switch_mouse_through_window_label: switch_mouse_through_window.label().to_owned(),
    });

    Ok(())
}

pub async fn close_full_screen_draw_window(
    app: tauri::AppHandle,
    full_screen_draw_window_labels: tauri::State<'_, Mutex<Option<FullScreenDrawWindowLabels>>>,
) -> Result<(), String> {
    let mut full_screen_draw_window_labels = full_screen_draw_window_labels.lock().await;
    let FullScreenDrawWindowLabels {
        full_screen_draw_window_label,
        switch_mouse_through_window_label,
    } = full_screen_draw_window_labels.take().unwrap();

    let window = app.get_webview_window(full_screen_draw_window_label.as_str());

    if let Some(window) = window {
        window.destroy().unwrap();
    }

    let window = app.get_webview_window(switch_mouse_through_window_label.as_str());
    if let Some(window) = window {
        window.destroy().unwrap();
    }

    Ok(())
}
#[derive(Serialize, Clone, Copy)]
pub struct MonitorInfo {
    mouse_x: i32,
    mouse_y: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    monitor_scale_factor: f32,
}

pub async fn get_current_monitor_info() -> Result<MonitorInfo, String> {
    #[cfg(target_os = "macos")]
    let (mut mouse_x, mut mouse_y, monitor) = get_target_monitor()?;
    #[cfg(not(target_os = "macos"))]
    let (mouse_x, mouse_y, monitor) = get_target_monitor()?;

    let monitor_x = monitor.x().unwrap();
    let monitor_y = monitor.y().unwrap();

    #[cfg(target_os = "macos")]
    let mut monitor_width = monitor.width().unwrap();
    #[cfg(not(target_os = "macos"))]
    let monitor_width = monitor.width().unwrap();

    #[cfg(target_os = "macos")]
    let mut monitor_height = monitor.height().unwrap();
    #[cfg(not(target_os = "macos"))]
    let monitor_height = monitor.height().unwrap();

    let monitor_scale_factor = monitor.scale_factor().unwrap();

    // macOS 下，屏幕宽高是逻辑像素，这里统一转换为物理像素
    #[cfg(target_os = "macos")]
    {
        monitor_width = (monitor_width as f32 * monitor_scale_factor) as u32;
        monitor_height = (monitor_height as f32 * monitor_scale_factor) as u32;
        // 把鼠标坐标转换为物理像素
        mouse_x = (mouse_x as f32 * monitor_scale_factor) as i32;
        mouse_y = (mouse_y as f32 * monitor_scale_factor) as i32;
    }

    let monitor_info = MonitorInfo {
        mouse_x: mouse_x - monitor_x,
        mouse_y: mouse_y - monitor_y,
        monitor_x: monitor_x,
        monitor_y: monitor_y,
        monitor_width: monitor_width,
        monitor_height: monitor_height,
        monitor_scale_factor: monitor_scale_factor,
    };
    Ok(monitor_info)
}

#[derive(Serialize, Clone)]
pub struct MonitorsBoundingBox {
    rect: ElementRect,
    monitor_rect_list: Vec<MonitorRect>,
}

pub async fn get_monitors_bounding_box(
    app: &tauri::AppHandle,
    region: Option<ElementRect>,
    enable_multiple_monitor: bool,
) -> Result<MonitorsBoundingBox, String> {
    let monitors =
        snow_shot_app_utils::get_capture_monitor_list(app, region, enable_multiple_monitor)?;

    let monitors_bounding_box = monitors.get_monitors_bounding_box();

    Ok(MonitorsBoundingBox {
        rect: monitors_bounding_box,
        monitor_rect_list: monitors.monitor_rect_list(),
    })
}

pub async fn send_new_version_notification(title: String, body: String) {
    notification::send_new_version_notification(title, body);
}

#[derive(Serialize, Clone, Copy)]
struct VideoRecordWindowInfo {
    select_rect_min_x: i32,
    select_rect_min_y: i32,
    select_rect_max_x: i32,
    select_rect_max_y: i32,
}

pub async fn has_video_record_window(
    video_record_window_labels: tauri::State<'_, Mutex<Option<VideoRecordWindowLabels>>>,
) -> Result<bool, String> {
    let video_record_window_labels = video_record_window_labels.lock().await;

    Ok(video_record_window_labels.is_some())
}

pub struct VideoRecordWindowLabels {
    video_record_window_label: String,
    toolbar_window_label: String,
}

/// 创建屏幕录制窗口
pub async fn create_video_record_window(
    app: tauri::AppHandle,
    video_record_window_label: tauri::State<'_, Mutex<Option<VideoRecordWindowLabels>>>,
    hot_load_page_service: tauri::State<'_, Arc<HotLoadPageService>>,
    select_rect_min_x: i32,
    select_rect_min_y: i32,
    select_rect_max_x: i32,
    select_rect_max_y: i32,
) {
    let mut video_record_window_labels = video_record_window_label.lock().await;
    if let Some(video_record_window_labels) = video_record_window_labels.as_ref() {
        let window = app.get_webview_window(
            video_record_window_labels
                .video_record_window_label
                .as_str(),
        );

        if let Some(window) = window {
            window
                .emit(
                    "reload-video-record",
                    VideoRecordWindowInfo {
                        select_rect_min_x,
                        select_rect_min_y,
                        select_rect_max_x,
                        select_rect_max_y,
                    },
                )
                .unwrap();

            return;
        }
    }

    // 先从服务中获取两个窗口（必须串行以避免竞态条件）
    let main_window_opt = hot_load_page_service.pop_page().await;
    let toolbar_window_opt = hot_load_page_service.pop_page().await;

    let has_hot_load = main_window_opt.is_some() || toolbar_window_opt.is_some();

    let main_window_url = format!(
        "/videoRecord?select_rect_min_x={}&select_rect_min_y={}&select_rect_max_x={}&select_rect_max_y={}",
        select_rect_min_x, select_rect_min_y, select_rect_max_x, select_rect_max_y
    );
    let toolbar_window_url = format!(
        "/videoRecord/toolbar?select_rect_min_x={}&select_rect_min_y={}&select_rect_max_x={}&select_rect_max_y={}",
        select_rect_min_x, select_rect_min_y, select_rect_max_x, select_rect_max_y
    );

    // 并行创建/配置两个窗口
    let (main_window, toolbar_window) = tokio::join!(
        async {
            match main_window_opt {
                Some(window) => {
                    window.set_always_on_top(true).unwrap();
                    window.set_title("Snow Shot - Video Record").unwrap();
                    window.hide().unwrap();

                    match window.emit(
                        "hot-load-page-route-push",
                        HotLoadPageRoutePushEvent {
                            label: window.label().to_owned(),
                            url: main_window_url.clone(),
                        },
                    ) {
                        Ok(_) => (),
                        Err(e) => {
                            log::error!("[create_video_record_window] Failed to emit event: {}", e);
                        }
                    }

                    window
                }
                None => tauri::WebviewWindowBuilder::new(
                    &app,
                    "video-recording",
                    tauri::WebviewUrl::App(PathBuf::from(main_window_url.clone())),
                )
                .always_on_top(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .title("Snow Shot - Video Record")
                .position(0.0, 0.0)
                .inner_size(10.0, 10.0)
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .build()
                .unwrap(),
            }
        },
        async {
            match toolbar_window_opt {
                Some(window) => {
                    window.set_always_on_top(true).unwrap();
                    window
                        .set_title("Snow Shot - Video Record - Toolbar")
                        .unwrap();
                    window.hide().unwrap();

                    match window.emit(
                        "hot-load-page-route-push",
                        HotLoadPageRoutePushEvent {
                            label: window.label().to_owned(),
                            url: toolbar_window_url.clone(),
                        },
                    ) {
                        Ok(_) => (),
                        Err(e) => {
                            log::error!("[create_video_record_window] Failed to emit event: {}", e);
                        }
                    }

                    window
                }
                None => tauri::WebviewWindowBuilder::new(
                    &app,
                    "video-recording-toolbar",
                    tauri::WebviewUrl::App(PathBuf::from(toolbar_window_url.clone())),
                )
                .always_on_top(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .title("Snow Shot - Video Record - Toolbar")
                .position(0.0, 0.0)
                .inner_size(10.0, 10.0)
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .build()
                .unwrap(),
            }
        }
    );

    if has_hot_load {
        match hot_load_page_service.create_idle_windows().await {
            Ok(_) => (),
            Err(e) => {
                log::error!(
                    "[create_video_record_window] Failed to create idle windows: {}",
                    e
                );
            }
        }
    }

    *video_record_window_labels = Some(VideoRecordWindowLabels {
        video_record_window_label: main_window.label().to_owned(),
        toolbar_window_label: toolbar_window.label().to_owned(),
    });
}

pub async fn close_video_record_window(
    app: tauri::AppHandle,
    video_record_window_label: tauri::State<'_, Mutex<Option<VideoRecordWindowLabels>>>,
) -> Result<(), String> {
    let mut video_record_window_labels = video_record_window_label.lock().await;
    let VideoRecordWindowLabels {
        video_record_window_label,
        toolbar_window_label,
    } = video_record_window_labels.take().unwrap();

    let window = app.get_webview_window(video_record_window_label.as_str());
    if let Some(window) = window {
        window.destroy().unwrap();
    }

    let window = app.get_webview_window(toolbar_window_label.as_str());
    if let Some(window) = window {
        window.destroy().unwrap();
    }

    Ok(())
}

pub async fn start_free_drag(
    window: tauri::Window,
    free_drag_window_service: tauri::State<'_, Mutex<FreeDragWindowService>>,
) -> Result<(), String> {
    let mut free_drag_window_service = free_drag_window_service.lock().await;

    free_drag_window_service.start_drag(window)?;

    Ok(())
}

pub async fn start_resize_window(
    window: tauri::Window,
    resize_window_service: tauri::State<'_, Mutex<ResizeWindowService>>,
    side: ResizeWindowSide,
    spect_ratio: f64,
    min_width: f64,
    max_width: f64,
) -> Result<(), String> {
    let mut resize_window_service = resize_window_service.lock().await;
    resize_window_service.start_resize(window, side, spect_ratio, min_width, max_width)?;
    Ok(())
}

pub async fn set_current_window_always_on_top(
    #[allow(unused_variables)] window: tauri::WebviewWindow,
    #[allow(unused_variables)] allow_input_method_overlay: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window_ns = window.ns_window();

        let window_ns = match window_ns {
            Ok(window_ns) => window_ns as usize,
            Err(_) => {
                return Err(String::from(
                    "[set_current_window_always_on_top] Failed to get NSWindow",
                ));
            }
        };

        match window.run_on_main_thread(move || unsafe {
            use objc2::runtime::AnyObject;
            use objc2_app_kit::NSWindowCollectionBehavior;
            use std::ffi::c_void;

            let window_ns = window_ns as *mut c_void;

            if window_ns.is_null() {
                log::error!("[set_current_window_always_on_top] NSWindow is null");
                return;
            }

            let window_ns = window_ns as *mut AnyObject;

            // level 为 20 不遮挡输入法
            if allow_input_method_overlay {
                let _: () = objc2::msg_send![window_ns, setLevel: 20];
            } else {
                let _: () =
                    objc2::msg_send![window_ns, setLevel: objc2_app_kit::NSStatusWindowLevel + 1];
            }

            let _: () = objc2::msg_send![
                window_ns,
                setCollectionBehavior: NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
            ];
        }) {
            Ok(_) => (),
            Err(_) => {
                return Err(String::from(
                    "[set_current_window_always_on_top] Failed to run on main thread",
                ));
            }
        }

        match window.set_focus() {
            Ok(_) => (),
            Err(_) => {
                log::warn!("[set_current_window_always_on_top] Failed to set focus");
            }
        }
    }

    Ok(())
}

pub async fn close_window_after_delay(window: tauri::Window, delay: u64) {
    // 用另一个进程运行，tauri 执行完命令后会发送消息给原窗口，一定时间后窗口可能已经提前销毁了
    // 发送消息给已经销毁的窗口会报错
    tokio::spawn(async move {
        time::sleep(time::Duration::from_millis(delay)).await;
        match window.close() {
            Ok(_) => (),
            Err(_) => log::info!("[close_window_after_delay] The window has been released"),
        }
    });
}

pub async fn create_admin_auto_start_task() -> Result<(), String> {
    snow_shot_app_os::utils::create_admin_auto_start_task()
}

pub async fn delete_admin_auto_start_task() -> Result<(), String> {
    snow_shot_app_os::utils::delete_admin_auto_start_task()
}

pub async fn restart_with_admin() -> Result<(), String> {
    snow_shot_app_os::utils::restart_with_admin()
}

pub async fn is_admin() -> Result<bool, String> {
    Ok(snow_shot_app_os::utils::is_admin())
}

pub async fn write_bitmap_image_to_clipboard(
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let image_data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        _ => {
            return Err(String::from(
                "[write_bitmap_image_to_clipboard] Invalid request body",
            ));
        }
    };

    snow_shot_app_utils::write_bitmap_image_to_clipboard(image_data).await
}

/// 保留目录中指定的文件，删除其他所有文件
pub async fn retain_dir_files(dir_path: PathBuf, file_names: Vec<String>) -> Result<(), String> {
    // 检查目录是否存在和是否是目录
    if !dir_path.exists() {
        return Err(format!(
            "[retain_dir_files] Directory does not exist: {:?}",
            dir_path
        ));
    }

    if !dir_path.is_dir() {
        return Err(format!(
            "[retain_dir_files] Path is not a directory: {:?}",
            dir_path
        ));
    }

    // 将要保留的文件名转换为 HashSet 以提高查找效率
    let file_names_set: std::collections::HashSet<String> = file_names.into_iter().collect();

    // 读取目录内容并筛选需要删除的文件
    let mut entries = fs::read_dir(&dir_path)
        .await
        .map_err(|e| format!("[retain_dir_files] Failed to read directory: {}", e))?;

    let mut files_to_delete = Vec::new();

    // 同步遍历目录条目，避免复杂的异步嵌套
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("[retain_dir_files] Failed to read directory entry: {}", e))?
    {
        let path = entry.path();

        // 只处理文件，跳过目录和其他类型
        if !path.is_file() {
            continue;
        }

        // 获取文件名进行比较
        if let Some(file_name) = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|s| s.to_string())
        {
            // 如果文件名不在保留列表中，加入删除列表
            if !file_names_set.contains(&file_name) {
                files_to_delete.push(path);
            }
        }
    }

    // 限制删除数量，防止意外大量删除
    let max_delete_count = 100;
    let actual_delete_count = files_to_delete.len().min(max_delete_count);

    if files_to_delete.len() > max_delete_count {
        log::warn!(
            "[retain_dir_files] Too many files to delete ({}), limiting to {}",
            files_to_delete.len(),
            max_delete_count
        );
    }

    // 并发删除文件，收集删除结果
    let delete_results =
        futures::stream::iter(files_to_delete.into_iter().take(actual_delete_count).map(
            |path| async move {
                match fs::remove_file(&path).await {
                    Ok(()) => Ok(path),
                    Err(e) => {
                        log::warn!("[retain_dir_files] Failed to remove file {:?}: {}", path, e);
                        Err((path, e))
                    }
                }
            },
        ))
        .buffer_unordered(8) // 减少并发数量，提高稳定性
        .collect::<Vec<_>>()
        .await;

    // 统计删除结果
    let (success_count, error_count) =
        delete_results
            .iter()
            .fold((0, 0), |(success, error), result| match result {
                Ok(_) => (success + 1, error),
                Err(_) => (success, error + 1),
            });

    log::info!(
        "[retain_dir_files] Deletion completed: {} successful, {} failed",
        success_count,
        error_count
    );

    Ok(())
}

/// 设置窗口不参与视频录制
pub async fn set_exclude_from_capture(
    #[allow(unused_variables)] window: tauri::Window,
    #[allow(unused_variables)] enable: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let window_hwnd = window.hwnd();
        let window_hwnd = match window_hwnd {
            Ok(window_hwnd) => window_hwnd,
            Err(_) => {
                return Err(String::from(
                    "[set_exclude_from_capture] Failed to get HWND",
                ));
            }
        };

        let result = unsafe {
            windows::Win32::UI::WindowsAndMessaging::SetWindowDisplayAffinity(
                window_hwnd,
                if enable {
                    windows::Win32::UI::WindowsAndMessaging::WDA_EXCLUDEFROMCAPTURE
                } else {
                    windows::Win32::UI::WindowsAndMessaging::WDA_NONE
                },
            )
        };

        if result.is_err() {
            return Err(format!(
                "[set_exclude_from_capture] Failed to set window display affinity: {}",
                result.err().unwrap()
            ));
        }

        Ok(())
    }
}
