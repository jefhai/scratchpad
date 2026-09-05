//! The macOS Dock menu is separate from Tauri's menu bar and tray menus.
//!
//! AppKit requests it through `NSApplicationDelegate::applicationDockMenu:`:
//! https://developer.apple.com/documentation/appkit/nsapplicationdelegate/applicationdockmenu(_:)
//! Tao already owns that delegate. Add a method-only subclass to the existing
//! object so its launch, reopen, termination, and restoration methods survive.
//! Native Quit is also routed through the runtime's save-before-exit barrier.

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::ptr;

    use objc2::rc::Retained;
    use objc2::runtime::{
        AnyObject, ClassBuilder, NSObject, NSObjectProtocol, ProtocolObject, Sel,
    };
    use objc2::{
        define_class, msg_send, sel, ClassType, DefinedClass, MainThreadMarker, MainThreadOnly,
        Message,
    };
    use objc2_app_kit::{
        NSApplication, NSApplicationDelegate, NSApplicationTerminateReply, NSControlStateValueOff,
        NSControlStateValueOn, NSMenu, NSMenuItem,
    };
    use objc2_foundation::{ns_string, NSString};

    struct ActionState {
        app: tauri::AppHandle,
        id: String,
    }

    define_class!(
        // SAFETY: NSObject has no additional subclass invariants. This class
        // owns initialized Rust ivars and never overrides NSObject methods.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ScratchpadDockAction"]
        #[ivars = ActionState]
        struct DockAction;

        unsafe impl NSObjectProtocol for DockAction {}

        impl DockAction {
            // The Dock may send nil as the sender. The identifier belongs to
            // this retained target, never to an assumed NSMenuItem sender.
            #[unsafe(method(scratchpadDockActivate:))]
            fn activate(&self, _sender: Option<&AnyObject>) {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    let _keep_alive = self.retain();
                    let state = self.ivars();
                    let _ = crate::runtime::menu_action(&state.app, &state.id);
                }));
                if result.is_err() {
                    // Never print window names, labels, or workspace contents.
                    eprintln!("Scratchpad could not perform a Dock menu action.");
                }
            }
        }
    );

    impl DockAction {
        fn new(mtm: MainThreadMarker, app: &tauri::AppHandle, id: String) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(ActionState {
                app: app.clone(),
                id,
            });
            // SAFETY: Rust ivars are initialized before NSObject's initializer.
            unsafe { msg_send![super(this), init] }
        }
    }

    struct DisplayedMenu {
        // Drop the menu before releasing its weak action targets.
        _menu: Retained<NSMenu>,
        _targets: Vec<Retained<DockAction>>,
    }

    struct DockState {
        app: tauri::AppHandle,
        // Keep the current menu alive after applicationDockMenu: returns and
        // until the next request. Targets are weak properties of NSMenuItem.
        displayed: Option<DisplayedMenu>,
        // Keep one previous generation through adjacent native event delivery.
        previous: Option<DisplayedMenu>,
        _delegate: Retained<ProtocolObject<dyn NSApplicationDelegate>>,
    }

    thread_local! {
        // NSMenu and its targets must never be sent to another thread.
        static DOCK_STATE: RefCell<Option<DockState>> = const { RefCell::new(None) };
    }

    fn append_action(
        menu: &NSMenu,
        targets: &mut Vec<Retained<DockAction>>,
        mtm: MainThreadMarker,
        app: &tauri::AppHandle,
        title: &str,
        action: String,
        focused: bool,
    ) {
        let target = DockAction::new(mtm, app, action);
        // SAFETY: The selector has a matching void(id) implementation on the
        // target, which is retained together with the displayed menu.
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(title),
                Some(sel!(scratchpadDockActivate:)),
                ns_string!(""),
            )
        };
        unsafe { item.setTarget(Some(target.as_ref())) };
        item.setEnabled(true);
        item.setState(if focused {
            NSControlStateValueOn
        } else {
            NSControlStateValueOff
        });
        menu.addItem(&item);
        targets.push(target);
    }

    fn app_handle() -> Option<tauri::AppHandle> {
        DOCK_STATE.with(|slot| {
            slot.try_borrow()
                .ok()
                .and_then(|state| state.as_ref().map(|state| state.app.clone()))
        })
    }

    fn build_menu(mtm: MainThreadMarker) -> Option<Retained<NSMenu>> {
        let app = app_handle()?;

        // The runtime returns a snapshot. No RefCell or native menu borrow is
        // held while requesting entries or later performing an action.
        let entries = crate::runtime::window_entries(&app);
        let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), ns_string!("Scratchpad"));
        menu.setAutoenablesItems(false);
        let mut targets = Vec::with_capacity(entries.len() + 1);
        append_action(
            &menu,
            &mut targets,
            mtm,
            &app,
            "New Window",
            "new-window".into(),
            false,
        );
        if !entries.is_empty() {
            menu.addItem(&NSMenuItem::separatorItem(mtm));
        }
        for (label, name, focused) in entries {
            append_action(
                &menu,
                &mut targets,
                mtm,
                &app,
                &name,
                format!("focus:{label}"),
                focused,
            );
        }

        let displayed = DisplayedMenu {
            _menu: menu.clone(),
            _targets: targets,
        };
        // Drop an old menu only after releasing the RefCell borrow, since
        // native object destruction can itself cause native callbacks.
        let retired = DOCK_STATE.with(|slot| {
            let mut state = slot.borrow_mut();
            let state = state.as_mut()?;
            let previous = state.displayed.replace(displayed);
            Some(std::mem::replace(&mut state.previous, previous))
        });
        drop(retired);
        Some(menu)
    }

    extern "C-unwind" fn application_dock_menu(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &NSApplication,
    ) -> *mut NSMenu {
        let Some(mtm) = MainThreadMarker::new() else {
            return ptr::null_mut();
        };
        match catch_unwind(AssertUnwindSafe(|| build_menu(mtm))) {
            // applicationDockMenu: follows Objective-C's autoreleased return
            // convention. DockState independently retains the live menu.
            Ok(Some(menu)) => Retained::autorelease_return(menu),
            Ok(None) => ptr::null_mut(),
            Err(_) => {
                eprintln!("Scratchpad could not build its Dock menu.");
                ptr::null_mut()
            }
        }
    }

    extern "C-unwind" fn application_should_terminate(
        _delegate: &AnyObject,
        _selector: Sel,
        _application: &NSApplication,
    ) -> NSApplicationTerminateReply {
        // This native request can originate from Dock Quit or system logout.
        // Cancel the immediate termination while the runtime flushes editors;
        // only its completed save barrier may authorize a subsequent exit.
        if MainThreadMarker::new().is_none() {
            return NSApplicationTerminateReply::TerminateCancel;
        }
        let result = catch_unwind(AssertUnwindSafe(|| {
            let Some(app) = app_handle() else {
                return NSApplicationTerminateReply::TerminateCancel;
            };
            if crate::runtime::exit_approved(&app) {
                return NSApplicationTerminateReply::TerminateNow;
            }
            let _ = crate::runtime::menu_action(&app, "quit");
            NSApplicationTerminateReply::TerminateCancel
        }));
        result.unwrap_or_else(|_| {
            eprintln!("Scratchpad cancelled native termination because its save barrier failed.");
            NSApplicationTerminateReply::TerminateCancel
        })
    }

    /// Install once from Tauri's setup callback, which runs on the main thread.
    /// An off-thread call fails rather than blocking a not-yet-running event loop.
    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            "The Dock menu must be installed on the macOS main thread.".to_string()
        })?;
        if DOCK_STATE.with(|slot| slot.borrow().is_some()) {
            return Ok(());
        }

        let application = NSApplication::sharedApplication(mtm);
        let delegate = application
            .delegate()
            .ok_or_else(|| "Tauri's macOS application delegate is not available.".to_string())?;
        let object: &AnyObject = delegate.as_ref();
        let superclass = object.class();
        if superclass.responds_to(sel!(applicationDockMenu:)) {
            return Err("The macOS application delegate already has a Dock menu provider.".into());
        }
        if superclass.responds_to(sel!(applicationShouldTerminate:)) {
            return Err(
                "The macOS application delegate already has a termination provider.".into(),
            );
        }

        // Register targets now so any class registration error occurs during
        // setup, not while AppKit is tracking the Dock menu.
        let _ = DockAction::class();
        let mut builder = ClassBuilder::new(c"ScratchpadDockDelegate", superclass)
            .ok_or_else(|| "The Scratchpad Dock delegate could not be registered.".to_string())?;
        // SAFETY: Both callbacks match AppKit's signatures. The termination
        // reply is objc2's NSUInteger-backed type, with its correct encoding.
        // No existing lifecycle method is overridden and no ivar is added.
        unsafe {
            builder.add_method(
                sel!(applicationDockMenu:),
                application_dock_menu as extern "C-unwind" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(applicationShouldTerminate:),
                application_should_terminate as extern "C-unwind" fn(_, _, _) -> _,
            );
        }
        let subclass = builder.register();
        if subclass.instance_size() != superclass.instance_size() {
            return Err(
                "The Dock delegate subclass unexpectedly changed its instance layout.".into(),
            );
        }

        // SAFETY: This subclass adds only previously absent methods and has
        // exactly the existing object's layout. Setup and all native delegate
        // changes occur on the main thread. Keep Tao's original object/ivars.
        // https://docs.rs/objc2/latest/objc2/runtime/struct.AnyObject.html#method.set_class
        let previous = unsafe { AnyObject::set_class(object, subclass) };
        assert_eq!(
            previous, superclass,
            "The application delegate class changed during Dock setup."
        );

        DOCK_STATE.with(|slot| {
            *slot.borrow_mut() = Some(DockState {
                app: app.clone(),
                displayed: None,
                previous: None,
                _delegate: delegate.clone(),
            });
        });
        // Refresh any AppKit cached optional-delegate-method flags while
        // retaining and reinstalling the same Tao delegate object.
        application.setDelegate(None);
        application.setDelegate(Some(&delegate));
        Ok(())
    }
}
