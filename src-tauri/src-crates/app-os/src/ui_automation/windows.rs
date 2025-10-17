use std::cmp::Ordering;
use std::collections::HashMap;
use std::mem;

use atree::Arena;
use atree::Token;
use rtree_rs::{RTree, Rect};
use uiautomation::UIAutomation;
use uiautomation::UIElement;
use uiautomation::UITreeWalker;
use uiautomation::types::Point;

use snow_shot_app_shared::ElementRect;
use snow_shot_app_utils::monitor_info::MonitorList;
use xcap::Window;

use super::ElementLevel;
use super::UIAutomationError;

enum ElementChildrenNextSiblingCacheItem {
    Element(UIElement, ElementLevel),
    /**
     * 叶子节点
     */
    Leaf,
    /**
     * 没有下一个兄弟节点
     */
    NoNext,
}

pub struct UIElements {
    automation: Option<UIAutomation>,
    automation_walker: Option<UITreeWalker>,
    root_element: Option<UIElement>,
    element_cache: RTree<2, i32, ElementLevel>,
    element_level_map: HashMap<ElementLevel, (UIElement, Token)>,
    element_rect_tree: Arena<uiautomation::types::Rect>,
    element_children_next_sibling_cache: HashMap<ElementLevel, ElementChildrenNextSiblingCacheItem>,
    window_rect_map: HashMap<ElementLevel, uiautomation::types::Rect>,
    window_index_level_map: HashMap<i32, ElementLevel>,
}

unsafe impl Send for UIElements {}
unsafe impl Sync for UIElements {}

impl UIElements {
    pub fn new() -> Self {
        Self {
            automation: None,
            automation_walker: None,
            root_element: None,
            element_rect_tree: Arena::new(),
            element_cache: RTree::new(),
            element_level_map: HashMap::new(),
            element_children_next_sibling_cache: HashMap::new(),
            window_rect_map: HashMap::new(),
            window_index_level_map: HashMap::new(),
        }
    }

    pub fn init(&mut self) -> Result<(), UIAutomationError> {
        if self.automation.is_some() {
            return Ok(());
        }

        let automation = UIAutomation::new()?;
        let automation_walker = automation.get_content_view_walker()?;

        self.automation = Some(automation);
        self.automation_walker = Some(automation_walker);

        Ok(())
    }

    pub fn convert_element_rect_to_rtree_rect(rect: uiautomation::types::Rect) -> Rect<2, i32> {
        Rect::new(
            [rect.get_left(), rect.get_top()],
            [rect.get_right(), rect.get_bottom()],
        )
    }

    fn normalize_rect(rect: uiautomation::types::Rect) -> uiautomation::types::Rect {
        // 当前矩形的数据不可信，做个纠正
        let mut rect_left = rect.get_left();
        let mut rect_top = rect.get_top();
        let mut rect_right = rect.get_right();
        let mut rect_bottom = rect.get_bottom();

        if rect_left > rect_right {
            mem::swap(&mut rect_left, &mut rect_right);
        }

        if rect_top > rect_bottom {
            mem::swap(&mut rect_top, &mut rect_bottom);
        }

        uiautomation::types::Rect::new(rect_left, rect_top, rect_right, rect_bottom)
    }

    fn beyond_rect(
        rect: uiautomation::types::Rect,
        parent_rect: uiautomation::types::Rect,
    ) -> bool {
        if rect.get_left() < parent_rect.get_left() {
            return true;
        }

        if rect.get_right() > parent_rect.get_right() {
            return true;
        }

        if rect.get_top() < parent_rect.get_top() {
            return true;
        }

        if rect.get_bottom() > parent_rect.get_bottom() {
            return true;
        }

        false
    }

    pub fn clip_rect(
        rect: uiautomation::types::Rect,
        parent_rect: uiautomation::types::Rect,
    ) -> uiautomation::types::Rect {
        uiautomation::types::Rect::new(
            rect.get_left().max(parent_rect.get_left()),
            rect.get_top().max(parent_rect.get_top()),
            rect.get_right().min(parent_rect.get_right()),
            rect.get_bottom().min(parent_rect.get_bottom()),
        )
    }

    /**
     * 初始化窗口元素缓存
     */
    pub fn init_cache(&mut self) -> Result<(), UIAutomationError> {
        self.root_element
            .replace(self.automation.as_ref().unwrap().get_root_element()?);

        let root_element = self.root_element.as_ref().unwrap();

        self.element_rect_tree = Arena::new();
        self.element_cache = RTree::new();
        self.element_level_map.clear();
        self.element_children_next_sibling_cache.clear();
        self.window_rect_map.clear();
        self.window_index_level_map.clear();

        // 桌面的窗口索引应该是最高，因为其优先级最低
        let mut current_level = ElementLevel::root();
        let monitors_bounding_box = MonitorList::all(true).get_monitors_bounding_box();
        let root_element_rect = uiautomation::types::Rect::new(
            monitors_bounding_box.min_x,
            monitors_bounding_box.min_y,
            monitors_bounding_box.max_x,
            monitors_bounding_box.max_y,
        );

        let mut root_tree_token = self.element_rect_tree.new_node(root_element_rect);
        let (_, mut parent_tree_token) = self.insert_element_cache(
            &mut root_tree_token,
            root_element.clone(),
            root_element_rect,
            current_level,
        );

        // 遍历所有窗口
        let windows = Window::all().unwrap_or_default();

        let automation = self.automation.as_ref().unwrap();
        let mut children_list: Vec<UIElement> = Vec::with_capacity(windows.len());

        for window in windows {
            if window.is_minimized().unwrap_or(true) {
                continue;
            }

            match window.title() {
                Ok(title) => {
                    if title.eq("Shell Handwriting Canvas") || title.eq("Snow Shot - Draw") {
                        continue;
                    }

                    title
                }
                Err(_) => continue,
            };

            let window_hwnd = match window.hwnd() {
                Ok(hwnd) => hwnd,
                Err(_) => continue,
            };

            if let Ok(element) = automation
                .element_from_handle(uiautomation::types::Handle::from(window_hwnd as isize))
            {
                children_list.push(element);
            }
        }

        // 窗口层级
        current_level.window_index = 0;
        current_level.next_level();

        for current_child in children_list {
            current_level.window_index += 1;
            current_level.next_element();

            let current_child_rect = current_child.get_bounding_rectangle()?;

            let (current_child_rect, _) = self.insert_element_cache(
                &mut parent_tree_token,
                current_child.clone(),
                current_child_rect,
                current_level,
            );

            self.window_rect_map
                .insert(current_level.clone(), current_child_rect);
            self.window_index_level_map
                .insert(current_level.window_index, current_level.clone());
        }

        Ok(())
    }

    pub fn get_element_from_point(
        &self,
        mouse_x: i32,
        mouse_y: i32,
    ) -> Result<Option<ElementRect>, UIAutomationError> {
        let automation = match self.automation.as_ref() {
            Some(automation) => automation,
            None => return Ok(None),
        };

        let element = automation.element_from_point(Point::new(mouse_x, mouse_y))?;
        let rect = element.get_bounding_rectangle()?;

        Ok(Some(ElementRect {
            min_x: rect.get_left(),
            min_y: rect.get_top(),
            max_x: rect.get_right(),
            max_y: rect.get_bottom(),
        }))
    }

    pub fn insert_element_cache(
        &mut self,
        parent_tree_token: &mut Token,
        element: UIElement,
        element_rect: uiautomation::types::Rect,
        element_level: ElementLevel,
    ) -> (uiautomation::types::Rect, Token) {
        let element_rect = uiautomation::types::Rect::new(
            element_rect.get_left(),
            element_rect.get_top(),
            element_rect.get_right(),
            element_rect.get_bottom(),
        );

        let mut element_rect = Self::normalize_rect(element_rect);

        let window_rect = self
            .window_rect_map
            .get(
                &self
                    .window_index_level_map
                    .get(&element_level.window_index)
                    .unwrap_or(&element_level),
            )
            .unwrap_or(&element_rect)
            .clone();

        if Self::beyond_rect(element_rect, window_rect) {
            element_rect = Self::clip_rect(element_rect, window_rect);
        }

        self.element_cache.insert(
            Self::convert_element_rect_to_rtree_rect(element_rect),
            element_level,
        );

        let current_node = self.element_rect_tree.new_node(element_rect);
        parent_tree_token
            .append_node(&mut self.element_rect_tree, current_node)
            .unwrap();
        self.element_level_map
            .insert(element_level, (element, current_node));

        (element_rect, current_node)
    }

    fn get_element_from_cache(
        &self,
        mouse_x: i32,
        mouse_y: i32,
    ) -> Option<(UIElement, ElementLevel, uiautomation::types::Rect, Token)> {
        let element_rect = self
            .element_cache
            .search(Rect::new_point([mouse_x, mouse_y]));

        // 获取层级最高的元素
        let mut max_level = ElementLevel::root();
        let mut max_level_rect = None;
        for rect in element_rect {
            if max_level.cmp(&rect.data) == Ordering::Less {
                max_level = rect.data.clone();
                max_level_rect = Some(rect.rect);
            }
        }
        let element_rtree_rect = match max_level_rect {
            Some(rect) => {
                uiautomation::types::Rect::new(rect.min[0], rect.min[1], rect.max[0], rect.max[1])
            }
            None => return None,
        };

        match self.element_level_map.get(&max_level) {
            Some((element, token)) => {
                Some((element.clone(), max_level, element_rtree_rect, *token))
            }
            None => None,
        }
    }

    // fn skip_invalid_window(
    //     &self,
    //     automation_walker: &UITreeWalker,
    //     current_element: &mut uiautomation::Result<UIElement>,
    //     parent_level: &ElementLevel,
    // ) {
    //     // 跳过 Snow Shot 窗口
    //     if parent_level.is_root() {
    //         if let Ok(element) = current_element.as_ref() {
    //             if let Ok(name) = element.get_name() {
    //                 if name == "Snow Shot - Draw" {
    //                     *current_element = automation_walker.get_next_sibling(element);
    //                     return;
    //                 }
    //             }

    //             unsafe {
    //                 if let Ok(handle) = element.get_native_window_handle() {
    //                     let window_hwnd: HWND = handle.into();
    //                     if !IsWindow(Some(window_hwnd)).as_bool()
    //                         || !IsWindowVisible(window_hwnd).as_bool()
    //                         || IsIconic(window_hwnd).as_bool()
    //                     {
    //                         *current_element = automation_walker.get_next_sibling(element);
    //                         return;
    //                     }
    //                 }
    //             }
    //         }
    //     }
    // }

    /**
     * 获取所有可选区域
     */
    pub fn get_element_from_point_walker(
        &mut self,
        mouse_x: i32,
        mouse_y: i32,
    ) -> Result<Vec<ElementRect>, UIAutomationError> {
        let automation_walker = self.automation_walker.clone().unwrap();
        let (parent_element, mut parent_level, parent_rect, mut parent_tree_token) =
            match self.get_element_from_cache(mouse_x, mouse_y) {
                Some(element) => element,
                None => (
                    self.root_element.clone().unwrap(),
                    ElementLevel::root(),
                    uiautomation::types::Rect::new(0, 0, i32::MAX, i32::MAX),
                    self.element_rect_tree
                        .new_node(uiautomation::types::Rect::new(0, 0, i32::MAX, i32::MAX)),
                ),
            };

        // 父元素必然命中了 mouse position，所以直接取第一个元素
        let mut current_level = ElementLevel::root();

        let mut queue = Option::<UIElement>::None;

        let mut try_get_first_child = false;
        // let mut cache_level = Option::<ElementLevel>::None;
        match self.element_children_next_sibling_cache.get(&parent_level) {
            Some(element) => match element {
                ElementChildrenNextSiblingCacheItem::Element(element, level) => {
                    queue = Some(element.clone());
                    current_level = level.clone();
                }
                // 叶子节点说明直接命中了，不需要重新获取
                ElementChildrenNextSiblingCacheItem::Leaf => {}
                // 没有下一个节点说明遍历结束了
                ElementChildrenNextSiblingCacheItem::NoNext => {}
            },
            None => {
                try_get_first_child = true;
            }
        };

        if try_get_first_child {
            // 没有命中缓存，说明是第一次获取
            let first_child = automation_walker.get_first_child(&parent_element);

            match first_child {
                Ok(element) => {
                    queue = Some(element.clone());
                    current_level = parent_level.clone();
                    current_level.next_level();

                    self.element_children_next_sibling_cache.insert(
                        parent_level,
                        ElementChildrenNextSiblingCacheItem::Element(element, current_level),
                    );
                }
                Err(_) => {
                    self.element_children_next_sibling_cache
                        .insert(parent_level, ElementChildrenNextSiblingCacheItem::Leaf);
                }
            }
        }

        let mut current_element_rect = parent_rect;
        let mut current_element_token = parent_tree_token;
        let mut result_token = current_element_token;
        let mut result_rect = current_element_rect;

        while let Some(current_element) = queue.take() {
            queue = None;

            current_element_rect = match current_element.get_bounding_rectangle() {
                Ok(rect) => rect,
                Err(_) => continue,
            };

            let current_element_left = current_element_rect.get_left();
            let current_element_right = current_element_rect.get_right();
            let current_element_top = current_element_rect.get_top();
            let current_element_bottom = current_element_rect.get_bottom();

            if !(current_element_left == 0
                && current_element_right == 0
                && current_element_top == 0
                && current_element_bottom == 0)
            {
                (current_element_rect, current_element_token) = self.insert_element_cache(
                    &mut parent_tree_token,
                    current_element.clone(),
                    current_element_rect,
                    current_level,
                );

                if current_element_left <= mouse_x
                    && current_element_right >= mouse_x
                    && current_element_top <= mouse_y
                    && current_element_bottom >= mouse_y
                {
                    result_token = current_element_token;
                    result_rect = current_element_rect;

                    let first_child = automation_walker.get_first_child(&current_element);
                    if let Ok(child) = first_child {
                        queue = Some(child.clone());
                        parent_tree_token = current_element_token;
                        parent_level = current_level;

                        current_level.next_level();

                        self.element_children_next_sibling_cache.insert(
                            parent_level,
                            ElementChildrenNextSiblingCacheItem::Element(child, current_level),
                        );

                        continue;
                    } else {
                        self.element_children_next_sibling_cache
                            .insert(current_level, ElementChildrenNextSiblingCacheItem::Leaf);
                    }
                }
            }

            let next_sibling = automation_walker.get_next_sibling(&current_element);
            match next_sibling {
                Ok(sibling) => {
                    queue = Some(sibling.clone());
                    current_level.next_element();

                    self.element_children_next_sibling_cache.insert(
                        parent_level,
                        ElementChildrenNextSiblingCacheItem::Element(sibling, current_level),
                    );
                }
                Err(_) => {
                    // 如果当前层级遍历结束了，标记已经遍历结束
                    self.element_children_next_sibling_cache
                        .insert(parent_level, ElementChildrenNextSiblingCacheItem::NoNext);
                }
            }
        }

        let element_ancestors = result_token.ancestors(&self.element_rect_tree);
        let mut result_rect_list = Vec::with_capacity(16);
        let mut previous_rect = ElementRect::from(result_rect);
        result_rect_list.push(previous_rect);
        for node in element_ancestors {
            let current_rect = ElementRect::from(node.data);
            if current_rect == previous_rect {
                continue;
            }

            if current_rect.min_x == previous_rect.max_x
                || current_rect.min_y == previous_rect.max_y
                || current_rect.min_x > previous_rect.max_x
                || current_rect.min_y > previous_rect.max_y
            {
                continue;
            }

            result_rect_list.push(current_rect);
            previous_rect = current_rect;
        }

        return Ok(result_rect_list);
    }
}

impl Drop for UIElements {
    fn drop(&mut self) {
        // 清理资源
        self.automation = None;
        self.automation_walker = None;
        self.root_element = None;
    }
}
