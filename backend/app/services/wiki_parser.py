from bs4 import BeautifulSoup
import re
from typing import Dict, List, Optional
import json

class WikiStructuredParser:
    """
    Algorithmic parser for Wiki pages to extract structured data without LLM.
    Focuses on Infoboxes, key sections (Appearance, Personality), and introductions.
    """

    # Keywords for section identification
    SECTION_KEYWORDS = {
        'appearance': ['外貌', '外观', 'Appearance', '样貌', '造型', '形象', '衣着'],
        'personality': ['性格', 'Personality', '人格', '特点', '性情'],
        'background': ['背景', 'Background', '经历', '故事', '来历', '生平', '简介'],
        'abilities': ['能力', 'Abilities', 'Skills', '技能', '战斗', '招式'],
        'relationships': ['关系', 'Relationships', '人际', '羁绊', '相关人物']
    }

    # Standard field mapping for Infobox
    FIELD_MAPPING = {
        'name': ['姓名', 'Name', '名字', '本名'],
        'gender': ['性别', 'Gender', 'Sex'],
        'age': ['年龄', 'Age'],
        'birthday': ['生日', 'Birthday'],
        'height': ['身高', 'Height'],
        'weight': ['体重', 'Weight'],
        'voice': ['配音', 'CV', '声优', 'Voice'],
        'affiliation': ['所属', '阵营', '组织', 'Affiliation'],
        'identity': ['身份', '职业', 'Title', 'Identity']
    }

    def parse_page(self, html: str, title: str = "") -> Dict:
        """Parse full page into structured data"""
        soup = BeautifulSoup(html, 'lxml')
        
        # 1. Extract Infobox
        infobox_data = self.extract_infobox(soup)
        
        # 2. Extract Key Sections
        sections = self.extract_sections_by_header(soup)
        
        # 3. Extract Summary (Intro)
        summary = self.extract_summary(soup)
        
        return {
            'title': title,
            'infobox': infobox_data,
            'sections': sections,
            'summary': summary
        }

    def extract_infobox(self, soup: BeautifulSoup) -> Dict[str, str]:
        """Extract data from standard Wiki Infobox"""
        data = {}
        
        # Locate infobox (works for Moegirl, Fandom, MediaWiki)
        infobox = soup.find('table', class_=lambda c: c and ('infobox' in c or 'wikitable' in c))
        
        if not infobox:
            return data

        for row in infobox.find_all('tr'):
            # Try th/td pair first (standard)
            header = row.find('th')
            value = row.find('td')
            
            # Fallback: Check for 2 tds where first is bold or acts as key
            if not header and not value:
                 cols = row.find_all('td')
                 if len(cols) == 2:
                     header = cols[0]
                     value = cols[1]

            if header and value:
                key_text = header.get_text(strip=True)
                val_text = value.get_text(strip=True)
                
                # Check for mapping
                mapped_key = None
                for std_key, keywords in self.FIELD_MAPPING.items():
                    if any(kw in key_text for kw in keywords):
                        mapped_key = std_key
                        break
                
                if mapped_key:
                    data[mapped_key] = val_text
                else:
                    if len(key_text) > 1 and len(key_text) < 15: # Valid key length
                        data[key_text] = val_text
                        
        return data

    def extract_sections_by_header(self, soup: BeautifulSoup) -> Dict[str, str]:
        """Extract paragraphs under specific headers"""
        sections = {}
        
        # Find headers (MediaWiki uses span.mw-headline inside h2/h3)
        headers = soup.find_all(['h2', 'h3'])
        
        for header in headers:
            # Try to get text from mw-headline span first
            headline = header.find('span', class_='mw-headline')
            header_text = headline.get_text(strip=True) if headline else header.get_text(strip=True)
            
            # Identify section type
            section_type = None
            for s_type, keywords in self.SECTION_KEYWORDS.items():
                if any(kw in header_text for kw in keywords):
                    section_type = s_type
                    break
            
            # ... (rest is same)
            if section_type and section_type not in sections:
                content_parts = []
                for sibling in header.find_next_siblings():
                    if sibling.name in ['h2', 'h3']:
                        break
                        
                    if sibling.name == 'p':
                        text = sibling.get_text(strip=True)
                        if len(text) > 10:
                            content_parts.append(text)
                            
                    elif sibling.name in ['ul', 'ol']: # Also extract lists!
                        items = [li.get_text(strip=True) for li in sibling.find_all('li')]
                        if items:
                            content_parts.append("\n".join(items[:5]))
                            
                    if len(content_parts) >= 5: # Increase limit
                        break
                
                if content_parts:
                    sections[section_type] = '\n'.join(content_parts)
                    
        return sections

    def extract_summary(self, soup: BeautifulSoup) -> str:
        """Extract the first meaningful paragraph as summary"""
        # Usually looking for the first <p> that is not empty and not inside a table
        
        # Skip paragraphs inside infoboxes or navboxes
        for p in soup.find_all('p'):
            # Check parents
            is_clean = True
            for parent in p.parents:
                if parent.name in ['table', 'li', 'ul', 'footer']:
                    is_clean = False
                    break
                if parent.get('class') and any('navbox' in c for c in parent.get('class')):
                    is_clean = False
                    break
            
            if is_clean:
                text = p.get_text(strip=True)
                if len(text) > 30: # Minimum length for a summary paragraph
                    return text
                    
        return ""

# Singleton instance
wiki_parser = WikiStructuredParser()
